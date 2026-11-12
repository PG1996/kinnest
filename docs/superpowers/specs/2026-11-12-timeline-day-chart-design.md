# Timeline day chart — design

Approved mock: https://claude.ai/artifact/MDQSRnen3D3SD15nLYQTdn (version 4). This note records what was agreed and the
calls made while building it.

## Why

The Timeline is a list. To understand a whole day — how sleep, feeds, diapers and medicine fit together — you need a
picture. Of a 24-hour ring and per-kind lanes, the user chose lanes: they scale to new kinds of activity (one more row),
and everything happening at one moment lines up top to bottom.

## What the Timeline becomes

One day at a time, like Feeds, Diapers and Sleep:

1. **Day pager** (existing `DayPager`): arrows, the tappable date, the 21-day strip with one dot per kind logged. Swipe the
   content sideways for the day before or after.
2. **Day chart**: one lane per kind across midnight to midnight, the lane's name and shape in the top band of its row,
   marks below it. Things with a length are bars (sleep, mom's feeds); moments are shapes (bottle feed = dot, diaper =
   square, dose = pill, vitals = diamond, visit or vaccine = diamond). Moments close together stack in up to three rows
   inside the lane; more shows a "+N" badge.
3. **Totals**: one tile per kind for the picked range (or the whole day): Sleep `11h 40m`, Feeds `9 · 270 ml · 116 min`,
   Diapers `7 · 6 wet · 1 dirty`, Medicine `7 doses`, Vitals `3 readings`, Visits & vaccines `1 visit`. Tapping a tile hides
   or shows that kind in the chart and the list. The tiles replace the filter chips.
4. **List**: the day's entries, newest first, limited to the picked range; rows open the editor as today.

Sideways phone (`orientation: landscape` and height ≤ 540px): the chart on the left (3/5, sticky), totals and list on the
right (2/5); the day strip hides, arrows and date stay.

## Picking a range

- Touch: **hold (380 ms), then drag**. A plain sideways drag is the day swipe. Mouse: plain drag.
- Handles at both ends adjust the range.
- Tap a mark: its span (bars) or ±10 minutes (moments). Tap an empty spot: whole day.
- Quick ranges: Night 12–6 AM, Morning 6–12, Afternoon 12–6 PM, Evening 6 PM–12.
- **Zoom** redraws the chart over just the range (with a little padding); **Whole day** clears range and zoom.
- Changing day clears both.

## Calls made while building (check these)

- **The Timeline no longer scrolls through many days.** The infinite list, its scroll-following strip and "Show earlier day"
  go; the day pager replaces them. Follows from "swipe like other pages" and the approved mock.
- **One fetch per day covering the day before too**, so a sleep or feed that started last night shows from midnight. The
  list shows entries that started on the day plus any that run into it from the night before.
- **Vitals keep their own lane; visits and vaccines share a "Visits & vaccines" lane that only appears on days that have
  one**, so the chart doesn't carry an empty row every day.
- **Skipped doses** are drawn as an outlined pill and counted separately ("6 doses · 1 skipped").
- **An ongoing sleep** runs to now, with a ring at its end; today's chart greys the hours after now.
- **No backend change.** `/api/timeline` already returns start, end and duration for every kind.
- Colours stay the app's own. Medicine purple vs vitals indigo and feed orange vs diaper green are hard to tell apart; the
  shapes and the lane names carry identity, so no colour change now.

## Non-goals

The 24-hour ring, a separate full-screen mode, week views, new activity kinds.
