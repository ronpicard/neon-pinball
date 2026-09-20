# Changelog

All notable changes to Neon Pinball are documented in this file, following the [Keep a Changelog](https://keepachangelog.com/) format.

## [1.1.0] - 2026-09-20

### Added

- The machine now stands in an arcade: rows of upright cabinets with running games on their screens, neon signs, neighbouring pinball machines, and blacklight carpet.
- The backbox is a scoreboard: a large dot-matrix display shows your score, the ball number and award messages, under new retro arcade backglass art.
- On phones, tap the left or right side of the screen to flip, and hold `HOLD TO LAUNCH` or the right side to pull the plunger. The menu, HUD and game-over card fit small screens, notches and both orientations.
- The game lowers its rendering cost by itself when a device cannot keep up. `?quality=high` and `?quality=low` in the address pin it.

### Changed

- The game opens on the low view from behind the flippers, which now also shows the scoreboard. The camera button and `C` cycle from there to the standing view and the top-down view. On a phone held upright the low view becomes the steep standing view so the whole table fits.
- Much less glare: a gentler bloom, dimmer lamps and bumper flashes, brushed steel in place of mirror chrome, and a satin lockdown bar.
- The ball is polished steel with hairline scratches, and it reflects the arcade around it instead of glowing white.
- Materials look like the real thing: painted wood grain on the rails and cabinet, brushed stainless guides and legs, pebbled rubber and plastic, powder-coated steel, faint wear in the playfield lacquer, and screw heads on the plastics.

## [1.0.0] - 2026-09-20

### Added

- A full 3D pinball machine in retro arcade neon: a lacquered playfield under glass, a chrome ball that mirrors the room, lit inserts, a backbox with a lit backglass and a dot-matrix score display, all standing in a dark arcade.
- Three pop bumpers, two slingshots, three top lanes with lane change, a bank of three drop targets, four `P` `L` `A` `Y` standup targets, a spinner on the left orbit, a ramp that carries the ball over the playfield to the left inlane, a saucer with mystery awards, inlanes and outlanes, and a one-way gate out of the shooter lane.
- Rules with a bonus multiplier up to 5X, super bumpers, a lit spinner, ramp combos, a three-ball multiball with 25,000-point jackpots, an extra ball, a twelve-second ball save, an end-of-ball bonus count, and a tilt sensor with two warnings.
- A plunger you pull and release for a soft or hard launch, flippers that can cradle and aim the ball, and table nudging.
- Keyboard controls, and on-screen flipper, plunger and nudge controls for touch screens, with both flippers playable at once.
- Three camera views: standing at the machine, straight down on the playfield, and low behind the flippers.
- The five best scores are saved in your browser with three-letter initials.
- An attract mode that plays the machine by itself behind the menu.
- Synthesised arcade sound effects with a mute toggle.
- Deployed to GitHub Pages on every push to `main`.
