# Odd One Out — Neon Party multiplayer

A real-time room-code word party game. Players do not need accounts or app installs; the host runs the server and shares the public URL. Built with Node.js, Express and Socket.IO.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`
3. Run `npm start`
4. Open `http://localhost:3000`

For friends on different devices, deploy this folder to a Node-compatible host that supports WebSockets (for example Render, Railway, or a VPS), then share the deployed URL. Localhost is only accessible on the same computer unless you configure LAN access.

## Game rules in this first version

- 3–30 players per room; room codes are six characters.
- The server privately sends each player their secret word.
- Players take turns submitting a single-word clue.
- Players vote for another player; correct guesses earn 100 points. The odd player earns 100 points if not caught, or 25 points if caught.
- Host can move to voting early, start another round, or reset the game.

## Important prototype notes

- Rooms live in server memory. Restarting/redeploying the server clears active rooms.
- This version uses anonymous temporary socket IDs, not account logins.
- Before a public classroom launch, add rate limiting, stronger reconnect/rejoin support, automated tests, and review the voting/disconnect edge cases. Use HTTPS on the deployed site.
