# Youtube TV

A lean-back player for a household that turns YouTube videos into live, TV-style Channels.

## Language

### Programming

**Channel**:
A named, always-on lineup of videos drawn from one or more Sources, tuned into like a TV channel. Never a YouTube channel.
_Avoid_: Station, lineup, stream

**Group**:
The Channels put inside another Channel, however deep. That Channel airs its own Sources' videos and every video in its Group, under its own Filters and Ordering; each Channel in the Group still airs on its own. Splitting a Channel means moving its Sources into new Channels in its Group. Only Channels outside any Group show on Home and in the Guide; the rest are picked from the Group button while watching.
_Avoid_: Folder, sub-channel, category

**Source**:
A place a Channel draws videos from: a YouTube channel, a YouTube playlist, or a hand-picked video list.
_Avoid_: Feed, input

**Share**:
A Source's slice of its Channel's airtime, weighed against the Channel's other Sources, used only when the Channel mixes by Share (Shuffle and New uploads first). Otherwise every video airs equally often, so bigger Sources air more.
_Avoid_: Weight, ratio, priority

**YouTube channel**:
A creator's channel on YouTube, used as one kind of Source. Always written in full.
_Avoid_: Channel (on its own), creator

**Filter**:
A Channel's rule that keeps certain videos off it: Shorts, too long, too old, a blocked keyword in the title, or a livestream from a YouTube channel Source (playlists and lists keep their livestreams).
_Avoid_: Exclusion, block rule

**Excluded video**:
A video someone removed from one Channel for good; it never airs on that Channel again.
_Avoid_: Banned, blocked, hidden video

**Ordering**:
A Channel's own rule for the sequence its videos air in: Shuffle, New uploads first, Fixed order, or Release order.
_Avoid_: Sort, play mode

**Shuffle**:
The default Ordering: a set mix of recent videos and Back catalog (e.g. 3 to 1), each drawn at random with no repeats until that group has all aired. With the mix turned off, every video is drawn equally whatever its age.

**Back catalog**:
A Channel's videos older than its recent cut-off (e.g. 6 months).
_Avoid_: Archive, old videos

**Fixed order**:
The Ordering where videos air Source by Source in the Channel's listed order, each Source oldest first (playlists and lists keep their own order), then loop.

**Release order**:
The Ordering where every video airs oldest published first, whatever its Source, then loops.

**New uploads first**:
The Ordering where a New upload airs right after the current Slot once someone Tunes in; everything else airs in Shuffle order.

**New upload**:
A video published after its Source was added to the Channel that hasn't aired on that Channel yet.
_Avoid_: Fresh video, latest video

### People

**Household**:
Everyone who watches; they all share the same Channels, with no profiles or logins.
_Avoid_: User, account, profile

**Screen**:
One TV or display running the app, watching one Channel at a time.
_Avoid_: Device, client, player

**Room**:
A group of Screens, joined by a link, that play the same Channel at the same moment: pausing, seeking, skipping or changing Channel on one does it on all. Whoever started it is the host and can make playback theirs alone; by default everyone controls it. Volume, captions and the panels stay per Screen.
_Avoid_: Party, session, watch together

**Tune in**:
Switching a Screen to a Channel; it always lands at Live.
_Avoid_: Open, select, switch to

### Time

**Schedule**:
The timeline of which video each Channel airs when, which runs whether or not anyone is watching. Past and current Slots never change; upcoming ones can.
_Avoid_: Playlist, queue

**Slot**:
One video's scheduled airing on a Channel, with a start and end time.
_Avoid_: Program, airing, episode

**Live**:
The point in a Channel's Schedule that is airing right now.

**Time-shift**:
How far behind or ahead of Live a Screen is watching a Channel. Tuning in always resets it to zero.
_Avoid_: Delay, offset, lag

**Restart**:
Playing the current Slot from its beginning, which Time-shifts the Screen.

**Go live**:
Dropping a Screen's Time-shift back to zero.
_Avoid_: Catch up, sync

**Timed comment**:
A top YouTube comment that points at a moment in its video (like 2:34). All of them are listed under the Comments panel's Timed tab, and unless a Screen turns popups off, each pops up for a few seconds as its moment plays (three at most at once). Clicking a cut-off popup opens it in full until clicked again. Comments with more than three timestamps are chapter lists and are left out.
_Avoid_: Live chat, bullet comment

**Guide**:
The browsable view of every Channel's Schedule, past and future, from which any Slot can be played.
_Avoid_: EPG, TV guide
