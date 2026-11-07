"""Check targeted wake-ups, queued turns and durable delivery without model calls."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('mention_worker', Path(__file__).parents[1] / 'public/agent-worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MentionWorkerTests(unittest.TestCase):
    def make_worker(self, directory, inbox):
        config = Path(directory) / 'config.json'
        module.save_json(config, {'site': 'https://test.invalid', 'token': 'synthetic', 'workspace': directory})
        worker = module.Worker(config)
        calls = []

        class Api:
            def call(self, body=None, **kwargs):
                if body:
                    calls.append(body.copy())
                    return {'ok': True}
                return inbox
        worker.api = Api()
        worker.state.update(started=True, fingerprint=module.fingerprint(inbox))
        return worker, calls

    def inbox(self):
        return {'agent': {'id': 'dev', 'name': 'Dev'}, 'routing_version': 1,
                'messages': [], 'context_messages': [], 'active_card': None, 'next_card': None}

    def test_background_context_does_not_wake_an_agent(self):
        inbox = self.inbox()
        inbox['context_messages'] = [{'id': 'context', 'created_at': 1, 'body': 'For PM', 'channel': 'general'}]
        with tempfile.TemporaryDirectory() as directory:
            worker, calls = self.make_worker(directory, inbox)
            worker.run_agent = lambda *args, **kwargs: self.fail('Background context started a turn')
            worker.tick()
            self.assertEqual(worker.state['history'][0]['id'], 'context')
            self.assertEqual(calls, [])

    def test_targeted_request_preserves_active_card_and_acknowledges_reply(self):
        inbox = self.inbox()
        inbox['active_card'] = {'id': 'active', 'status': 'working'}
        inbox['messages'] = [{'id': 'request', 'created_at': 5, 'body': '@R01 question',
                              'channel': 'general', 'author_type': 'human'}]
        with tempfile.TemporaryDirectory() as directory:
            worker, calls = self.make_worker(directory, inbox)
            prompts = []
            def model(prompt):
                prompts.append(prompt)
                return {'summary': 'Answered', 'actions': [{'action': 'message', 'channel': 'general', 'body': 'Answer', 'reply_to': ''}]}
            worker.run_agent = model
            worker.tick()
            self.assertEqual([call['action'] for call in calls], ['message_delivery', 'message', 'message_delivery'])
            self.assertEqual(calls[0]['status'], 'responding')
            self.assertEqual(calls[1]['reply_to'], 'request')
            self.assertEqual(calls[2]['status'], 'received')
            self.assertEqual(inbox['active_card']['id'], 'active')
            self.assertNotIn('claim', [call['action'] for call in calls])
            self.assertEqual(worker.state['cursor'], [5, 'request'])
            inbox['messages'] = []
            worker.tick()
            self.assertEqual(len(prompts), 1)

    def test_first_page_of_one_hundred_requests_is_processed(self):
        inbox = self.inbox()
        inbox['messages'] = [{'id': str(i), 'created_at': i, 'body': 'Question', 'channel': 'general', 'author_type': 'human'} for i in range(100)]
        with tempfile.TemporaryDirectory() as directory:
            worker, calls = self.make_worker(directory, inbox)
            worker.state['started'] = False
            worker.run_agent = lambda prompt: {'summary': 'Processed', 'actions': []}
            worker.tick()
            self.assertEqual(len(calls[0]['message_ids']), 100)
            self.assertTrue(worker.state['started'])

    def test_failed_outbox_resumes_before_reading_new_requests(self):
        inbox = self.inbox()
        inbox['messages'] = [{'id': 'request', 'created_at': 1, 'body': 'Question', 'channel': 'general', 'author_type': 'human'}]
        with tempfile.TemporaryDirectory() as directory:
            worker, calls = self.make_worker(directory, inbox)
            original = worker.api.call
            def failing(body=None, **kwargs):
                if body and body.get('action') == 'message':
                    raise RuntimeError('Temporary network failure')
                return original(body, **kwargs)
            worker.api.call = failing
            worker.run_agent = lambda prompt: {'summary': 'Reply', 'actions': [{'action': 'message', 'channel': 'general', 'body': 'Answer', 'reply_to': 'request'}]}
            with self.assertRaises(RuntimeError):
                worker.tick()
            self.assertIn('pending', worker.state)
            worker.api.call = original
            worker.deliver_outbox()
            self.assertNotIn('pending', worker.state)
            self.assertEqual(worker.state['cursor'], [1, 'request'])


if __name__ == '__main__':
    unittest.main()
