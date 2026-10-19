import asyncio, time, os
from aiosmtpd.controller import Controller
class H:
    async def handle_DATA(self, server, session, env):
        open(f"/tmp/claude-0/e2e/mails/{time.time():.6f}.eml","wb").write(env.content)
        return '250 OK'
c=Controller(H(), hostname='127.0.0.1', port=2525); c.start()
asyncio.get_event_loop().run_forever()
