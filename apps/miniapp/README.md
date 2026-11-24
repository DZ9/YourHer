# YourHer Mini Program

The original native WeChat client, connected to YourHer's shared backend. Includes the original desk home and onboarding, the original desk mood check-in flow, chat, memory, mood, letters, companion settings, feedback and account/data pages.

1. Run `npm start` from the repository root (Node.js 24+).
2. Import this directory into WeChat DevTools using your own AppID or a test account.
3. For localhost development only, disable domain checking in DevTools. The checked-in project configuration keeps it enabled by default.
4. Compile to open the desk home. Set up your companion, log a mood or open chat. The server starts in demo mode; configure the server's `.env` to use a real model.

Edit `src/config.js` to change the server URL or model reply language. No npm build or CloudBase environment is required. The native interface is Chinese; voice is optional and disabled by default.

[完整启动指南与验证范围 / Setup details and verification scope](../../docs/miniapp.md)
