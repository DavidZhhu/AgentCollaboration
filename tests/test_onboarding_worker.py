"""Offline behavior checks: no model API calls and no service installation."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'public/agent-worker.py')
worker_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker_module)

class OnboardingWorkerTests(unittest.TestCase):
    def test_repository_identity_and_existing_checkout(self):
        self.assertEqual(worker_module.github_identity('git@github.com:Example/Project.git'), 'example/project')
        self.assertIsNone(worker_module.github_identity('https://example.com/owner/repo'))
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['git', 'init', directory], check=True, capture_output=True)
            subprocess.run(['git', '-C', directory, 'remote', 'add', 'origin', 'git@github.com:Example/Project.git'], check=True)
            self.assertEqual(worker_module.prepare_checkout('https://github.com/example/project', directory, False), str(Path(directory).resolve()))
            with self.assertRaisesRegex(RuntimeError, 'different GitHub'):
                worker_module.prepare_checkout('https://github.com/example/other', directory, True)
            nested = Path(directory) / 'nested'
            nested.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'root folder'):
                worker_module.prepare_checkout('https://github.com/example/project', nested, False)

    def run_protocol(self, provider):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identifier = str(uuid.uuid4())
            fake = root / 'fake-ai'
            fake.write_text('''#!/usr/bin/env python3
import json, pathlib, sys
prompt = sys.stdin.read()
assert 'ac_private_test_token' not in prompt
args = sys.argv[1:]
pathlib.Path('arguments.json').write_text(json.dumps(args))
result = {'summary': 'reply', 'actions': []}
if '--output-last-message' in args:
    pathlib.Path(args[args.index('--output-last-message')+1]).write_text(json.dumps(result))
    print(json.dumps({'type': 'thread.started', 'thread_id': ''' + repr(identifier) + '''}))
else:
    print(json.dumps({'is_error':False, 'session_id':''' + repr(identifier) + ''', 'structured_output':result}))
''')
            fake.chmod(0o700)
            config = root / 'config.json'
            worker_module.save_json(config, {'site':'https://test.invalid', 'token':'ac_private_test_token', 'workspace':directory, 'provider':provider, 'codex':str(fake), 'claude':str(fake), 'session_mode':'new', 'session_id':''})
            worker = worker_module.Worker(config)
            self.assertEqual(worker.run_agent('Harmless test', read_only=True)['summary'], 'reply')
            args = json.loads((root / 'arguments.json').read_text())
            self.assertEqual(worker.state['session_id'], identifier)
            if provider == 'codex':
                self.assertIn('read-only', args)
                self.assertNotIn('--ephemeral', args)
            else:
                self.assertEqual(args[args.index('--tools')+1], '')
                self.assertIn('--session-id', args)
                self.assertIn('dontAsk', args)
            # A restart must resume the same session, preserving conversation continuity.
            worker = worker_module.Worker(config)
            worker.run_agent('Another harmless test')
            args = json.loads((root / 'arguments.json').read_text())
            self.assertIn(identifier, args)
            self.assertIn('resume' if provider == 'codex' else '--resume', args)

    def test_codex_session_continuity(self):
        self.run_protocol('codex')

    def test_claude_session_continuity(self):
        self.run_protocol('claude')

    def test_new_worker_waits_for_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config.json'
            worker_module.save_json(config, {'site':'https://test.invalid','token':'ac_test','workspace':directory,'codex':'/fake','require_setup_test':True})
            worker = worker_module.Worker(config)
            class Api:
                def call(self, **kwargs):
                    return {'next_card': {'id':'should-not-start'}, 'setup_verified':False}
            worker.api = Api()
            worker.run_agent = lambda *args, **kwargs: self.fail('Project work started before verification')
            worker.tick()
            self.assertFalse(worker.state['started'])

    def test_probe_requires_model_reply_and_no_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'config.json'
            worker_module.save_json(config, {'site':'https://test.invalid','token':'ac_private_test_token','workspace':directory,'codex':'/fake'})
            worker = worker_module.Worker(config)
            sent = []
            class Api:
                def call(self, body=None, **kwargs):
                    if body:
                        sent.append(body)
                        return {'ok':True}
                    return {'setup_check':{'nonce':'expected'}}
            worker.api = Api()
            calls = []
            def model(prompt, read_only=False):
                calls.append(read_only)
                return {'summary':'expected', 'actions':[]}
            worker.run_agent = model
            worker.tick()
            self.assertEqual(calls,[True])
            self.assertEqual(sent[0]['action'],'setup_check_result')
            self.assertEqual(sent[0]['nonce'],'expected')
            worker.run_agent = lambda *args, **kwargs: {'summary':'wrong', 'actions':[]}
            with self.assertRaisesRegex(RuntimeError,'expected connection-test reply'):
                worker.tick()
            self.assertEqual(len(sent),1)
            worker.run_agent = lambda *args, **kwargs: {'summary':'expected', 'actions':[{'action':'message'}]}
            with self.assertRaises(RuntimeError):
                worker.tick()
            self.assertEqual(len(sent),1)

if __name__ == '__main__':
    unittest.main()
