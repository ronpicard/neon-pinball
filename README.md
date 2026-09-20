# Neon Pinball

Neon Pinball is a 3D pinball machine that runs in the browser: a full cabinet with a lacquered playfield, a chrome ball, and lamps under the glass, dressed in retro arcade neon. Pop bumpers, slingshots, drop targets, a spinner, a ramp, a saucer, multiball, and a tilt sensor are all simulated. Play the [live demo](https://ronpicard.github.io/neon-pinball/) — it works on both phones and desktops.

## How to play

- Left flipper: `Left Arrow`, `Left Shift`, `Z`, or `A`. Right flipper: `Right Arrow`, `Right Shift`, `/`, `M`, or `D`.
- Plunger: hold `Space`, `Enter`, or `Down Arrow` to pull it back and let go to launch. The longer the pull, the harder the launch: a full pull sends the ball around the top arch and down the left orbit, and a soft one drops it into the top lanes.
- Nudge: `Q` shoves the table left, `E` shoves it right, and `W` or `Up Arrow` shoves it up. Nudging can save a ball, but too much of it costs a warning, and the third warning tilts the machine: the flippers go dead and the ball's bonus is lost.
- Touch: the lower left and lower right of the screen are the flippers (both can be held at once), with a plunger button and a nudge button above them.
- `C` or the camera button cycles the view: standing at the machine, straight down on the playfield, and low behind the flippers following the ball.
- `P` or `Escape` pauses. Switching to another tab pauses too.
- Three balls a game. A ball that drains in its first twelve seconds of play is served again for free.
- The five best scores are saved in your browser, arcade style, with three initials.
- While the menu is up, the machine plays itself in attract mode.

## The table

| Shot | What it does |
| --- | --- |
| Pop bumpers (3) | 100 points a hit, or 1,000 while the super bumpers are lit |
| Slingshots (2) | 10 points and a kick back up the table |
| Top lanes `A` `R` `C` | 500 each. Light all three for 5,000, a higher bonus multiplier (up to 5X), and 20 seconds of super bumpers. The flippers move the lit lanes left and right |
| Drop targets `1` `2` `3` | 500 each. Knock the whole bank down for 5,000 and a lit spinner, and the bank resets |
| Standup targets `P` `L` `A` `Y` | 500 each. Light all four for 10,000 and, once a game, a lit extra ball at the saucer |
| Spinner (left orbit) | 100 a spin, or 1,000 a spin while lit. The inlanes light it for a few seconds |
| Ramp | 2,500, multiplied by back-to-back combos up to 5X. Every third ramp starts a three-ball multiball |
| Multiball | Every ramp is a 25,000 jackpot until only one ball is left |
| Saucer | 3,000 and the lit extra ball, or else the next mystery award: points, a lit spinner, a bonus multiplier, or a ball save |
| Inlanes and outlanes | 250 and a lit spinner from an inlane, and a 2,000 consolation from an outlane |

Targets and ramps bank a bonus that is multiplied and paid out when the ball drains.

## The physics

The ball is simulated in two dimensions on the sloped playfield, in inches and seconds, 480 steps a second, so a ball at full speed never moves more than a third of its own radius between collision checks. Walls, posts, targets and the one-way shooter gate are line segments and circles with their own bounce. The flippers are rotating capsules: the ball takes the speed of the point of the flipper it touches, so a shot off the tip is faster than one off the base, and a held flipper can cradle a ball. The ramp lifts the ball off the playfield onto a rail, where it slows against the climb and either rolls back out of the entrance or crests and runs down to the left inlane. Balls collide with each other in multiball. Nothing in the simulation is random, so the same inputs always play the same game.

A ball that sits still with no flipper held gets kicked free after four seconds, the way a real machine runs a ball search.

## Proven playable

An autoplayer drives the real physics and rules: it pulls the plunger, and flips when a ball comes into a flipper's reach. The test suite plays full games with it and fails if a ball ever leaves the table, gets stuck, or never reaches the playfield, or if a game fails to exercise the bumpers, slingshots, rollovers, flippers and drain. The same player runs the attract mode behind the menu. To watch its numbers:

```bash
npm run simulate -- 5
```

This prints each game's score, its length, and how many times each part of the table fired.

## Tech stack

- React 19 and TypeScript for the menu, HUD, touch controls, and game-over screen
- Plain three.js for the machine: physically based materials, an environment map for the chrome, soft shadows, and a bloom pass for the neon
- Every texture is drawn in code at start-up (playfield art, backglass, cabinet sides, carpet, and the dot-matrix score display) — no image files
- Web Audio, synthesised in code at runtime — no audio files
- Vite for building and development
- Node's built-in test runner (`node:test`), no separate test framework
- No backend — high scores and the mute setting live in `localStorage`
- GitHub Actions and GitHub Pages for continuous deployment

## Project layout

The game logic is kept separate from rendering and input, so the table, the physics, the rules and the
autoplayer can be unit tested without a browser or a canvas:

```text
src/game/    the table layout, the physics, the rules and scoring, high scores, and the autoplayer
src/render/  the three.js engine and its public API, the playfield and cabinet models, procedural textures, keyboard input
src/ui/      React components for the menu, HUD, touch controls, game-over card, and canvas mount
src/audio.ts synthesised sound effects
scripts/     the headless game simulator
```

## Development

Requires Node >= 22.12.

Everything under `src/game/` is framework-free — no DOM, no three.js, and no non-deterministic calls
like `Math.random` or `Date` — so `npm test` runs directly in Node without spinning up a browser.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server |
| `npm test` | Run the table, physics, rules, high-score, and autoplayer tests |
| `npm run simulate` | Play headless games with the autoplayer and report what happened |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |

## Deployment

Pushes to `main` run a GitHub Actions workflow that installs dependencies, runs the test suite,
builds the production bundle, and publishes the `dist` output to GitHub Pages.

Vite is configured with a relative `base` in `vite.config.ts`, so the built asset paths resolve
correctly whether the site is served from the domain root or from a repository subpath like
`/neon-pinball/`.

## License

[MIT](LICENSE)
