#!/usr/bin/env python3
"""Inbox relay for an EXISTING agent conversation. Never launches an AI process."""
import argparse
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib import error, parse, request
import uuid

USER_AGENT = 'AgentCollaboration-Session/1.0'


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, indent=2)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load(path, default=None):
    path = Path(path)
    return json.loads(path.read_text()) if path.exists() else default


def https_site(value):
    parsed = parse.urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise RuntimeError('Use the HTTPS origin of your AgentCollaboration website.')
    return value.rstrip('/')


class ApiError(RuntimeError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class Api:
    def __init__(self, config):
        self.config = config

    def call(self, body=None, cursor=None, status=False):
        url = self.config['site'] + '/api/agent'
        if status:
            url += '?status=1'
        elif cursor:
            url += '?' + parse.urlencode({'after': cursor[0], 'after_id': cursor[1]})
        headers = {'User-Agent': USER_AGENT, 'Authorization': 'Bearer ' + self.config['token'], 'X-AgentCollab-Worker': self.config['controller_id']}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except error.HTTPError as problem:
            try:
                detail = json.load(problem).get('error', 'Website request failed.')
            except (ValueError, AttributeError):
                detail = 'Website returned HTTP ' + str(problem.code)
            raise ApiError(problem.code, detail.replace(self.config['token'], '[redacted]')) from None

    def heartbeat(self, status='idle'):
        return self.call({'action': 'worker_heartbeat', 'status': status, 'mode': 'session', 'label': self.config.get('label', 'Current conversation')})


def fingerprint(inbox):
    team = inbox.get('team') or {}
    meaningful = {'project': inbox.get('project'), 'active': inbox.get('active_card'), 'next': inbox.get('next_card'),
                  'check': inbox.get('setup_check'), 'cards': team.get('cards'), 'decisions': team.get('decisions'),
                  'agents': [{key: agent.get(key) for key in ('id', 'name', 'role', 'provider', 'responsibility')} for agent in team.get('agents', [])]}
    return hashlib.sha256(json.dumps(meaningful, sort_keys=True).encode()).hexdigest()


class Session:
    def __init__(self, config_path):
        self.path = Path(config_path).expanduser().resolve()
        self.config = load(self.path)
        if not self.config:
            raise RuntimeError('Configure this role first.')
        self.api = Api(self.config)
        self.state_path = self.path.parent / 'session-state.json'

    def read(self):
        state = load(self.state_path, {'cursor': [0, ''], 'fingerprint': None})
        inbox = self.api.call(cursor=state['cursor'])
        messages = inbox.get('messages', [])
        relevant = [item for item in messages if not (item.get('author_type') == 'agent' and item.get('author') == inbox['agent']['name'])]
        signature = fingerprint(inbox)
        changed = bool(relevant) or signature != state.get('fingerprint')
        cursor = [messages[-1]['created_at'], messages[-1]['id']] if messages else state['cursor']
        return state, inbox, signature, cursor, changed

    def deliver(self):
        state, inbox, signature, cursor, changed = self.read()
        if not changed:
            if cursor != state['cursor']:
                state['cursor'] = cursor
                save(self.state_path, state)
            return None
        # Delivery does not consume the event. Only an explicit ack from the owning conversation does.
        state['delivered'] = {'cursor': cursor, 'fingerprint': signature}
        save(self.state_path, state)
        return {'event': 'inbox_changed', 'detected_at': int(time.time() * 1000), 'inbox': inbox, 'instructions': 'Handle this in the current conversation. Use action for website writes; ack after reading this delivery, then rearm watch in a background tool. Never launch a separate model.'}

    def ack(self):
        state = load(self.state_path, {})
        if not state.get('delivered'):
            raise RuntimeError('No delivered inbox event to acknowledge.')
        if load(self.path.parent / 'pending-action.json'):
            raise RuntimeError('Retry the pending website action before acknowledging this event.')
        state.update(state.pop('delivered'))
        save(self.state_path, state)
        return {'ok': True}

    def action(self, body=None, retry=False):
        lock = (self.path.parent / 'action.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise RuntimeError('Another session action is still being sent.') from None
        try:
            pending_path = self.path.parent / 'pending-action.json'
            pending = load(pending_path)
            if retry:
                if not pending:
                    raise RuntimeError('No pending action to retry.')
            else:
                if pending:
                    raise RuntimeError('A prior action is awaiting acknowledgement. Run retry before sending another action.')
                if not isinstance(body, dict) or not isinstance(body.get('action'), str):
                    raise RuntimeError('The action file must contain a JSON object with an action field.')
                if body['action'] == 'worker_heartbeat':
                    raise RuntimeError('Use watch or disconnect for connection management.')
                pending = {'body': body, 'id': str(uuid.uuid4())}
                save(pending_path, pending)
            self.api.heartbeat('running')
            # Retain an identity across retries, including when the response was lost after committing.
            try:
                result = self.request_action(pending)
            except ApiError as problem:
                # Definite validation/authorization rejections cannot succeed on replay.
                # Keep uncertain network/server outcomes for an idempotent retry.
                if problem.status in (400, 403, 404, 409, 410):
                    pending_path.unlink(missing_ok=True)
                raise
            pending_path.unlink(missing_ok=True)
            return result
        finally:
            lock.close()

    def request_action(self, pending):
        # Keep request-id handling in one small API variant without changing the action body.
        config = self.config
        req = request.Request(config['site'] + '/api/agent', data=json.dumps(pending['body']).encode(), headers={
            'Authorization': 'Bearer ' + config['token'], 'X-AgentCollab-Worker': config['controller_id'],
            'Content-Type': 'application/json', 'X-AgentCollab-Request-ID': pending['id']})
        try:
            with request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except error.HTTPError as problem:
            try:
                detail = json.load(problem).get('error', 'Website action failed.')
            except (ValueError, AttributeError):
                detail = 'Website action returned HTTP ' + str(problem.code)
            raise ApiError(problem.code, detail.replace(config['token'], '[redacted]')) from None

    def watch(self, timeout=60, interval=1):
        lock = (self.path.parent / 'watch.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise RuntimeError('This role already has a watcher in this configuration.') from None
        stop = threading.Event()
        failure = []
        def heartbeat():
            while not stop.wait(10):
                try:
                    self.api.heartbeat()
                except (OSError, ValueError, RuntimeError) as problem:
                    failure.append(problem)
                    stop.set()
        thread = None
        try:
            self.api.heartbeat()
            thread = threading.Thread(target=heartbeat, daemon=True)
            thread.start()
            deadline = time.monotonic() + timeout
            while not stop.is_set():
                event = self.deliver()
                if event:
                    self.api.heartbeat('running')
                    return event
                if time.monotonic() >= deadline:
                    return {'event': 'idle', 'instructions': 'Rearm watch as a background tool in THIS conversation. Do not send a chat reply for an idle timeout.'}
                stop.wait(min(interval, max(0, deadline - time.monotonic())))
            if failure:
                raise failure[0]
        finally:
            stop.set()
            if thread:
                thread.join(timeout=35)
            lock.close()


def git_identity(value):
    value = value.strip().rstrip('/')
    if value.startswith('git@github.com:'):
        value = 'https://github.com/' + value.split(':', 1)[1]
    parsed = parse.urlparse(value)
    parts = parsed.path.strip('/').removesuffix('.git').split('/')
    return '/'.join(parts).lower() if parsed.hostname == 'github.com' and len(parts) == 2 and all(parts) else None


def check_checkout(folder, repo):
    folder = Path(folder).expanduser().resolve()
    root = subprocess.run(['git', '-C', str(folder), 'rev-parse', '--show-toplevel'], capture_output=True, text=True, timeout=15)
    origin = subprocess.run(['git', '-C', str(folder), 'remote', 'get-url', 'origin'], capture_output=True, text=True, timeout=15)
    if root.returncode or origin.returncode or Path(root.stdout.strip()).resolve() != folder or not git_identity(repo) or git_identity(origin.stdout) != git_identity(repo):
        raise RuntimeError('Use the existing conversation’s Git root for the matching GitHub repository. Clone or open that project in the conversation first.')
    return folder


def configure(args):
    site = https_site(args.site)
    if args.code:
        req = request.Request(site + '/api/setup/exchange', data=json.dumps({'code': args.code}).encode(), headers={'Content-Type': 'application/json', 'User-Agent': USER_AGENT})
        try:
            with request.urlopen(req, timeout=30) as response:
                grant = json.load(response)
        except error.HTTPError as problem:
            try:
                detail = json.load(problem).get('error', 'Setup code could not be redeemed.')
            except (ValueError, AttributeError):
                detail = 'Setup request returned HTTP ' + str(problem.code)
            raise RuntimeError(detail) from None
        if grant.get('session_mode') != 'current':
            raise RuntimeError('Generate a Current conversation command in the wizard.')
        token = grant['token']
        workspace = check_checkout(grant['workspace'], grant['repo'])
        provider = grant['provider']
    else:
        token = getpass.getpass('Agent token (hidden): ').strip()
        workspace = Path(args.workspace or os.getcwd()).expanduser().resolve()
        provider = args.provider
    config = {'site': site, 'token': token, 'workspace': str(workspace), 'provider': provider,
              'controller_id': str(uuid.uuid4()), 'label': args.label or 'Current conversation'}
    api = Api(config)
    health = api.call(status=True)
    if health.get('worker_online'):
        raise RuntimeError('Another worker or watcher is active. Stop it before connecting this conversation.')
    if args.agent_id and health['agent']['id'] != args.agent_id:
        raise RuntimeError('That token belongs to another agent. Use the selected role’s token.')
    if not args.code:
        inbox = api.call()
        workspace = check_checkout(workspace, inbox['project']['repo'])
        config['workspace'] = str(workspace)
    folder = (Path.home() / 'Library' / 'Application Support' if sys.platform == 'darwin' else Path.home() / '.local' / 'state') / 'AgentCollaboration' / 'sessions' / health['agent']['id']
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(folder, 0o700)
    destination = folder / 'agent-session.py'
    if Path(__file__).resolve() != destination.resolve():
        shutil.copyfile(__file__, destination)
    config_path = folder / 'config.json'
    save(config_path, config)
    for name in ('session-state.json',):
        if (folder / name).exists():
            (folder / name).unlink()
    base = shlex.join([sys.executable, str(destination)])
    suffix = ' --config ' + shlex.quote(str(config_path))
    print(json.dumps({'configured': True, 'agent': health['agent'], 'workspace': str(workspace),
        'watch_command': base + ' watch' + suffix + ' --timeout 60',
        'inbox_command': base + ' inbox' + suffix, 'ack_command': base + ' ack' + suffix,
        'action_command': base + ' action' + suffix + ' --file /absolute/path/to/action.json',
        'disconnect_command': base + ' disconnect' + suffix,
        'note': 'Paste the connection prompt into the EXISTING conversation. Configuration alone does not start a watcher. This relay never starts Claude or Codex.'}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('configure')
    init.add_argument('--site', required=True)
    init.add_argument('--code')
    init.add_argument('--workspace')
    init.add_argument('--provider', choices=['codex', 'claude'], default='claude')
    init.add_argument('--agent-id')
    init.add_argument('--label')
    for name in ('watch', 'inbox', 'ack', 'action', 'retry', 'status', 'disconnect'):
        command = commands.add_parser(name)
        command.add_argument('--config', required=True)
        if name == 'watch':
            command.add_argument('--timeout', type=int, choices=range(1, 301), default=60)
        if name == 'action':
            command.add_argument('--file', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'configure':
            configure(args)
            return 0
        session = Session(args.config)
        if args.command == 'watch':
            result = session.watch(timeout=args.timeout)
        elif args.command == 'inbox':
            session.api.heartbeat('running')
            result = session.deliver() or {'event': 'idle'}
        elif args.command == 'ack':
            result = session.ack()
        elif args.command == 'action':
            result = session.action(load(args.file))
        elif args.command == 'retry':
            result = session.action(retry=True)
        elif args.command == 'disconnect':
            result = session.api.heartbeat('stopped')
        else:
            result = session.api.call(status=True)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as problem:
        print('Session connection needs attention: ' + str(problem), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
