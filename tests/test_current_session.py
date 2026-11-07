import contextlib
import io
from types import SimpleNamespace
from unittest.mock import patch
import subprocess
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('relay', Path(__file__).parents[1] / 'public/agent-session.py')
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)

class SessionRelayTests(unittest.TestCase):
    def make_session(self, folder):
        config = Path(folder) / 'config.json'
        relay.save(config, {'site':'https://test.invalid','token':'ac_test_secret','controller_id':'123','label':'Existing PM'})
        session = relay.Session(config)
        class FakeApi:
            def __init__(self):
                self.inbox = {'agent':{'name':'R0','id':'a','role':'R0'},'project':{'id':'p','direction':'Keep this project context'},'messages':[], 'team':{'agents':[],'cards':[],'decisions':[]},'active_card':None,'next_card':None}
                self.beats = []
            def heartbeat(self, status='idle'):
                self.beats.append(status)
            def call(self, cursor=None):
                result = dict(self.inbox)
                result['messages'] = [message for message in self.inbox['messages'] if (message['created_at'], message['id']) > tuple(cursor or (0,''))][:100]
                return result
        api = FakeApi(); session.api = api
        return session, api

    def test_delivery_waits_for_ack_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            session, api = self.make_session(folder)
            first = session.deliver()
            self.assertEqual(first['event'],'inbox_changed')
            restarted = relay.Session(session.path); restarted.api = api
            self.assertIsNotNone(restarted.deliver())
            restarted.ack()
            self.assertIsNone(restarted.deliver())
            api.inbox['messages'] = [{'id':'1','created_at':1,'author':'Owner','author_type':'human','body':'Please reply here','channel':'a'}]
            self.assertEqual(restarted.deliver()['inbox']['messages'][0]['body'],'Please reply here')
            restarted.ack()
            self.assertIsNone(restarted.deliver())

    def test_watch_returns_when_event_arrives_instead_of_waiting_for_timeout(self):
        with tempfile.TemporaryDirectory() as folder:
            session, api = self.make_session(folder)
            session.deliver(); session.ack()
            started = time.monotonic()
            original = api.call
            calls = []
            def read(cursor=None):
                calls.append(1)
                if len(calls) == 3:
                    api.inbox['messages'] = [{'id':'event','created_at':2,'author':'Owner','author_type':'human','body':'Unique test','channel':'general'}]
                return original(cursor)
            api.call = read
            event = session.watch(timeout=60, interval=0.01)
            self.assertEqual(event['inbox']['messages'][0]['body'],'Unique test')
            self.assertLess(time.monotonic()-started, 1)
            self.assertEqual(api.beats[0],'idle'); self.assertEqual(api.beats[-1],'running')

    def test_peer_heartbeats_and_own_replies_do_not_retrigger(self):
        with tempfile.TemporaryDirectory() as folder:
            session, api = self.make_session(folder)
            api.inbox['team']['agents']=[{'id':'peer','name':'R01','role':'R01','worker_seen':0}]
            session.deliver();session.ack()
            api.inbox['team']['agents'][0]['worker_seen']=123456
            api.inbox['messages']=[{'id':'self','created_at':1,'author':'R0','author_type':'agent','body':'Already replied'}]
            self.assertIsNone(session.deliver())

    def test_own_message_pagination_does_not_starve_incoming_messages(self):
        with tempfile.TemporaryDirectory() as folder:
            session, api = self.make_session(folder)
            session.deliver(); session.ack()
            api.inbox['messages']=[{'id':str(i),'created_at':i,'author':'R0','author_type':'agent','body':'Own reply'} for i in range(1,101)]
            api.inbox['messages'].append({'id':'new','created_at':101,'author':'Owner','author_type':'human','body':'Do not lose this'})
            self.assertIsNone(session.deliver())
            self.assertEqual(session.deliver()['inbox']['messages'][0]['body'],'Do not lose this')

    def test_connection_check_is_only_delivered_never_auto_answered(self):
        with tempfile.TemporaryDirectory() as folder:
            session, api = self.make_session(folder)
            api.inbox['setup_check']={'nonce':'challenge'}
            result = session.watch(timeout=1)
            self.assertEqual(result['inbox']['setup_check']['nonce'],'challenge')
            # The relay returns context to the existing model; only heartbeats were sent.
            self.assertEqual(api.beats,['idle','running'])

    def test_duplicate_watcher_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            session, _ = self.make_session(folder)
            with (Path(folder)/'watch.lock').open('a') as lock:
                relay.fcntl.flock(lock, relay.fcntl.LOCK_EX | relay.fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError,'already has a watcher'):
                    session.watch(timeout=1)

    def test_uncertain_action_retries_with_same_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            session, _ = self.make_session(folder)
            seen = []
            def dropped(pending):
                seen.append(dict(pending))
                raise OSError('Dropped response after server committed')
            session.request_action=dropped
            with self.assertRaises(OSError):session.action({'action':'message','body':'Once'})
            with self.assertRaisesRegex(RuntimeError,'prior action'):session.action({'action':'message','body':'Twice'})
            session.request_action=lambda pending:seen.append(dict(pending)) or {'ok':True}
            session.action(retry=True)
            self.assertEqual(seen[0]['id'],seen[1]['id'])
            self.assertFalse((Path(folder)/'pending-action.json').exists())

    def test_configuration_stores_token_privately_and_launches_only_git_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); workspace=root/'checkout';workspace.mkdir()
            subprocess.run(['git','init',str(workspace)],check=True,capture_output=True)
            subprocess.run(['git','-C',str(workspace),'remote','add','origin','https://github.com/example/project.git'],check=True)
            grant={'session_mode':'current','token':'ac_private_config_test','workspace':str(workspace),'repo':'https://github.com/example/project.git','provider':'claude'}
            class Health:
                def __init__(self, config): pass
                def call(self, **kwargs): return {'worker_online':False,'agent':{'id':'test-agent','name':'R0','role':'R0','provider':'Claude Code'}}
            output=io.StringIO()
            original=subprocess.run
            with patch.object(relay.request,'urlopen',return_value=io.BytesIO(json.dumps(grant).encode())) as setup_request, patch.object(relay,'Api',Health), patch.object(relay.Path,'home',return_value=root), patch.object(relay.subprocess,'run',wraps=original) as calls, contextlib.redirect_stdout(output):
                relay.configure(SimpleNamespace(site='https://test.invalid',code='single-use-test-code',workspace=None,provider='claude',agent_id='test-agent',label='Existing PM'))
            self.assertEqual(setup_request.call_args.args[0].get_header('User-agent'), relay.USER_AGENT)
            self.assertTrue(all(call.args[0][0]=='git' for call in calls.call_args_list))
            self.assertEqual(len(calls.call_args_list),2)
            self.assertNotIn('ac_private_config_test',output.getvalue())
            private=list(root.rglob('config.json'))
            self.assertEqual(len(private),1)
            self.assertEqual(private[0].stat().st_mode & 0o777,0o600)
            self.assertEqual(json.loads(private[0].read_text())['token'],'ac_private_config_test')
            self.assertIn('watch_command',json.loads(output.getvalue()))

    def test_api_requests_identify_the_session_helper(self):
        api = relay.Api({'site': 'https://test.invalid', 'token': 'test', 'controller_id': 'id'})
        for body in (None, {'action': 'worker_heartbeat', 'status': 'idle'}):
            with patch.object(relay.request, 'urlopen', return_value=io.BytesIO(b'{}')) as opened:
                api.call(body)
                self.assertEqual(opened.call_args.args[0].get_header('User-agent'), relay.USER_AGENT)

    def test_website_actions_identify_helper_and_keep_retry_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            session, _ = self.make_session(folder)
            for body in ({'action': 'claim', 'card_id': 'card'}, {'action': 'setup_check_result', 'nonce': 'challenge', 'summary': 'Ready'}):
                pending = {'id': 'stable-retry-id', 'body': body}
                with patch.object(relay.request, 'urlopen', return_value=io.BytesIO(b'{"ok":true}')) as opened:
                    self.assertEqual(session.request_action(pending), {'ok': True})
                    req = opened.call_args.args[0]
                    self.assertEqual(req.get_header('User-agent'), relay.USER_AGENT)
                    self.assertEqual(req.get_header('X-agentcollab-request-id'), pending['id'])
                    self.assertEqual(json.loads(req.data), body)

    def test_private_configuration_and_reject_bad_origins(self):
        with tempfile.TemporaryDirectory() as folder:
            session, _ = self.make_session(folder)
            self.assertEqual(session.path.stat().st_mode & 0o777, 0o600)
        for site in ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com?secret=1']:
            with self.assertRaises(RuntimeError):relay.https_site(site)
        self.assertEqual(relay.https_site('https://example.com/'),'https://example.com')

if __name__ == '__main__':unittest.main()
