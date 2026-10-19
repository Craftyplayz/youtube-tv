# The Schedule is live, but its future is mutable

Channels run on one live Schedule shared by every Screen, but only past and current Slots are fixed. On New uploads first Channels, a New upload waits until someone Tunes in, then is inserted right after the current Slot, because the Household doesn't want new videos airing to an empty room; on Shuffle Channels, newly published videos also join the upcoming Schedule as they appear. A fully pre-computed, deterministic Schedule was rejected: it would air New uploads whether or not anyone was watching, and any Slot in the Guide can be played on demand anyway, so locking the future buys little.

## Consequences

- The upcoming part of the Guide can change while someone is looking at it.
- A Screen never jumps mid-video because the Schedule changed; when its video ends, it follows whatever now comes next.
