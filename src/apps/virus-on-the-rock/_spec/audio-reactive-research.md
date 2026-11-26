# Audio-reactive visuals: what is praised, how it maps, our presets

Research of 2026-11-25 (web search by an agent, then read and condensed). Every claim below has its source. Search
snippets that were not opened are marked *(snippet)*; claims found nowhere are marked *not verified*.

## The headline

The most acclaimed works are **not** driven by per-band envelopes:

- Max Cooper's live shows are cued by hand: MIDI into Ableton, OSC out to Resolume [3].
- Ryoji Ikeda's *test pattern* turns the sound signal straight into barcode patterns [1].
- Björk's "Hollow" (Drew Berry) is animation authored in advance [8].

The per-band mapping practice comes from tools (MilkDrop, Synesthesia, Notch, TouchDesigner) [7][12][17][18] and from
vendor blogs [13–15], which are weak evidence. So our presets read each work's **look**; they do not copy its method.

## Shortlist (ranking is judgment)

1. **Ryoji Ikeda, *test pattern* / *datamatics*.** Sound turned into barcodes over 8 screens, "tightly synchronized" [1].
   Golden Nica 2001 for *Matrix* [2]. Reviewers praise the hard black and white contrast [4]. Beauty: no smoothing, binary
   contrast.
2. **Max Cooper and Maxime Causeret, "Order from Chaos" (2016).** Raindrops slowly become a rhythm; the brief was to map
   the emerging rhythm to emergence in living form [5]. "Mesmerizing" (Colossal, 2016) [6]. Beauty: structure grows with
   the music instead of pulsing on it.
3. **MilkDrop (Geiss) / Butterchurn.** Band levels read against their average (1.0 = average, above 1.3 = loud), a damped
   `_att` copy of each band, a frame decay of 0.98 [7]. Butterchurn is its WebGL port [16]. Beauty: levels relative to the
   song, long trails.
4. **Björk, "Hollow" (Drew Berry, 2012).** A journey down to the molecules, from real molecular data, projected live [8].
5. **Janet Iwasa, HIV life-cycle animation**, scored by Joshua Roman [9] *(snippet)*.
6. **kynd, *Lilium* (BRDG020, 2015)**, objects driven by FFT data, a force map distorting the image on ripple events [10]
   *(snippet)*; his Sawako videos "swell and recede" with the sound [11]. kynd and stems: *not verified*.
7. **Synesthesia (VJ app)**, for its documented audio model [12].

## Mapping principles

| Feature | Visual role | Mode | Behaviour | Source |
|---|---|---|---|---|
| Band level | size, glow | level | smoothed against jitter | [12] |
| Band "hits" | drums, accents | onset | spikes on isolated transients only | [12] |
| Band "presence" | section state (the bass is in) | slow level | follows sustained activity | [12] |
| Band "time" | a clock running faster when the band is loud (camera travel) | level into a clock | | [12] |
| BPM LFOs (÷1, 2, 4, 8) | bar-locked sway | phase | no audio jitter | [12] |
| bass vs bass_att | fast vs damped reading | level | relative to the song's average | [7] |
| Trails | persistence | decay | 0.98 per frame ≈ 0.57 s half-life at 60 fps | [7] |
| Kick / snare / hat | triggers | onset | short attack; longer decay, longer tail | [17] |
| Kick vs mids/highs | kick switches hard, mids/highs move fluidly | onset vs level | lag ≈ 0.01 snappy, 0.2 liquid; scale range 1.2–1.6 | [18] *(snippet)* |
| Restraint | map 3–5 parameters, spread over the bands | | routing everything to bass is "the most common mistake" | [13][14] (weak) |
| Ducking | the kick ducks the rest | onset | attack < 10 ms; release 20–75 ms, or a beat for a pump | [20] |
| Latency | sync | | visible past 45 ms audio lead or 125 ms lag: visuals may trail, never lead | [21] |
| Phrases | big changes on phrase boundaries (8/16/32 bars) | | | [22] *(snippet)* |
| Beat cuts | on the beat, not every beat | | every beat reads as predictable | [23] *(snippet)* |

## Our route sets (src/mol-plugin-state/helpers/audio-routing-inspired.ts)

Routes only, offered in the routing's **Saved…** list under "Inspired by acclaimed audio-visual works"; loading one
leaves the analysis and the motion shapes alone and turns on the motion targets its routes need. Each route has a
**curve**: Log lifts the quiet parts (Watercolour, the voice in Hollow Descent), Exp keeps only the peaks (Datamatics'
flash, Sidechain Pump's kick).

| Preset | After | Routes |
|---|---|---|
| Datamatics | Ikeda [1][4] | drums onset → background flash, illumination; treble onset → interior jitter; bass onset → symmetry axes |
| MilkDrop Breath | Geiss [7] | bass → camera zoom; loudness → hue (2.5 s release); drums onset → glow; treble → surface wiggle |
| Emergence | Cooper/Causeret [5] | melody → position wave; voice → surface glow; bass → slow symmetry opening; loudness → camera spin; drums → camera step every 8 hits |
| Hollow Descent | Berry [8] | loudness → slow zoom in; voice → surface proteins along the normal; drums onset → membrane along the normal; melody → interior wiggle |
| Sidechain Pump | Pack [20] | drums onset → symmetry axes and duck (250 ms); bass → membrane along the normal; hats → interior jitter; voice → glow |
| Watercolour | kynd [10][11] | voice → opacity; melody → hue; drums onset → position wave; bass → camera rock |

New route targets added for them: **background flash**, **camera step (phrases)**, **duck the other routes**. New
source: **Loudness (vs. the song)**, the loudness against its 8 s running average (MilkDrop's reading [7]; the average
reads 0.5). The shared stems are unchanged: a try at reading the band stand-ins against their running peak (2026-11-26)
held the symmetry axes open between drum hits (at rest 0.93 instead of 0.08 on Drums & Bass Burst) and was reverted.
Without separation, level routes on bass, other and vocals stay weak (0.01–0.1): a per-route gain or the Log curve
lifts them, never the shared signal.

Suggested but not built yet: saturation / monochrome, bloom, depth of field, fog, a level normalised to the song's
average (MilkDrop's 1.0), trails, a bar-locked LFO source, section-aware intensity (Synesthesia `syn_Intensity`).

## Sources

1. YCAM, *test pattern* — https://special.ycam.jp/datamatics/en/testpattern.html
2. Prix Ars Electronica 2001 press release — https://webarchive.ars.electronica.art/festival2001/press/pressprev8e.html
3. Si Truss, MusicRadar, 20 Nov 2024 — https://musicradar.com/artists/every-show-is-designed-for-the-space-so-every-show-is-different-max-cooper-explains-the-workings-of-his-unique-3d-av-live-shows
4. Joe Lloyd, Studio International, 2021 — https://www.studiointernational.com/ryoji-ikeda-review-180-studios-london-ear-shredding-eye-rending-fires-up-the-mind
5. Max Cooper, *Order from Chaos* — https://maxcooper.net/order-from-chaos ; video https://vimeo.com/196269431
6. Christopher Jobson, Colossal, 20 Dec 2016 — https://www.thisiscolossal.com/2016/12/order-from-chaos-video-maxime-causeret/
7. Geiss, MilkDrop preset authoring guide — https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html
8. WEHI, "Hollow" — https://wehi.edu.au/wehi-tv/bjork-hollow-music-video *(snippet)*
9. TED Ideas, Iwasa — https://ideas.ted.com/?p=109055 *(snippet)*
10. CreativeApplications, *Lilium* — https://www.creativeapplications.net/project/brdg020-lilium-kenichi-yoneda-kynd-in-collaboration-with-brdg/ *(snippet, page 403)*
11. Beckett Mufson, Vice, 30 Jul 2014 — https://www.vice.com/en/article/watch-code-generated-watercolors-flow-over-tranquil-tunes/
12. Synesthesia audio uniforms — https://app.synesthesia.live/docs/ssf/audio_uniforms.html
13. VJ Loop Studio, 2026, no author — https://vjloopstudio.com/posts/audio-reactive-guide/
14. Ghost Arcade, 2026, no author — https://ghostarcade.live/blog/audio-reactive-visuals-guide
15. kott.io, 2026 — https://kott.io/journal/audio-reactive-visuals-setup-nanokontrol2
16. Butterchurn — https://github.com/jberg/butterchurn
17. Notch manual, Working with Audio — https://manual.notch.one/2026.1/en/docs/learning/working-with-audio/
18. TouchDesigner audio-reactive tutorials *(snippets; which URL holds which number not confirmed)* — https://interactiveimmersive.io/blog/touchdesigner-lessons/audio-reactive-visuals-a-beginner-guide/
19. kynd — https://kynd.info
20. Brad Pack, Sonarworks, 21 Oct 2020 — https://www.sonarworks.com/blog/learn/sidechain-compression
21. Wikipedia, Audio-to-video synchronization (ITU-R BT.1359-1) — https://en.wikipedia.org/wiki/Audio-to-video_synchronization
22. Cursa, DJ phrasing — https://cursa.app/en/page/dj-mixing-foundations-bars-phrasing-and-starting-on-the-one *(snippet)*
23. LBB Online, editing music videos — https://lbbonline.com/news/more-than-just-cutting-to-the-beat-the-nuance-of-editing-music-videos *(snippet)*

Not researched: Winamp AVS, Magic Music Visuals, Shadertoy rankings, UKMVA, Vimeo Staff Picks, Refik Anadol.
