# Algorave distribution record — 2026-09-15

The repository `tetrisgm/chiptunes` is PUBLIC (verified with GitHub's API on this
date). The existing root LICENSE is MIT and is unchanged. The new artifact embeds
Strudel and superdough, declared AGPL-3.0-or-later; it must not be represented as an
MIT-only browser bundle. Retain original notices and provide the integrated work's
source with distribution. The UI Help links to the exact source snapshot, AGPL
text, and collected package notices alongside the artifact. No private source
publication or replacement of the original MIT license is required for this
packaging. The license boundary is the integration, not its iframe sandbox.

References checked on this date:
- https://strudel.cc/technical-manual/project-start/ describes Strudel integration,
  compatible licensing, derivative work and source publication requirements.
- https://www.gnu.org/licenses/gpl-faq.en.html describes compatible combinations
  and inclusion of dependent libraries in corresponding source.
- https://www.gnu.org/licenses/license-compatibility.en.html describes combining
  permissively licensed code with copyleft code. Original permissions/notices are
  preserved; labeling the resulting combination does not erase them.

`build.js` builds the same workspace into `dist/algorave`; the existing local
preview command uses the same builder. `dependencies.json` inventories packages
actually included by esbuild's input graph. The full runtime bundles upstream
web.mjs source rather than its prebundled distribution, so transitive inputs and
their notices remain visible. The pattern worker is no longer embedded.
The current inventory has 85 package entries, declaring MIT, ISC, BSD-2-Clause,
BSD-3-Clause or AGPL-3.0-or-later. `THIRD_PARTY_NOTICES.txt` preserves distributed
license/notice files. This inventory is evidence about these installed packages,
not a blanket legal assurance about future dependencies.

Three npm packages omit a standalone license file:
- @tonaljs/progression 4.9.2 declares MIT. Supplement its notices with Tonal's
  umbrella MIT notice, verified at https://github.com/tonaljs/tonal/blob/main/docs/LICENSE
  (Git blob 77ac35ab560a93e9c939409f86f9704f49daf66e).
- chord-voicings 0.0.1 declares ISC and names Felix Roos as author. Its published
  gitHead is 447ee7932851562dcfc480f54f5011430174a30d; that upstream repository also
  has no standalone license. Preserve this exact metadata and the package source;
  do not invent an upstream copyright statement. This omission remains visible
  in the dependency report for release review.

- sfumato 0.1.2 declares ISC and names Felix Roos as author. Its published
  gitHead is b5100e4b39345dbee1ed8c2ac13200ff73604585; both npm and that repository
  revision omit a standalone license. Preserve the metadata supplement and exact
  package. The seven preferred TypeScript/build files are additionally supplied
  in src/algorave/vendor/sfumato, checked against their upstream Git blob hashes.
  Its nested soundfont2 0.4.0 dependency includes its MIT license and source.

The standard sound setup loads Strudel's public bank catalogs and sample audio on
request; remote audio bytes are not embedded in the distribution. Its catalog
selection and piano helper follow Strudel's AGPL REPL prebake.mjs, attributed in
src/algorave/strudel-prebake.mjs. Piano recordings are Alexander Holm's Salamander
Grand Piano (CC BY 3.0); VCSL is CC0. Preserve the source/credit links below rather
than making a blanket license claim for every sample in an upstream collection:
- https://codeberg.org/uzu/strudel/src/branch/main/website/src/repl/prebake.mjs
- https://archive.org/details/SalamanderGrandPianoV3
- https://github.com/sgossner/VCSL
- https://github.com/ritchse/tidal-drum-machines
- https://github.com/tidalcycles/uzu-drumkit
- https://github.com/tidalcycles/uzu-wavetables
- https://github.com/yaxu/mrid
- https://github.com/tidalcycles/Dirt-Samples
- https://github.com/felixroos/webaudiofontdata

`source.tar.gz` contains a source allowlist from the Git working tree and the exact
npm package directories present in the algorave input graph. It includes their
original sources/source maps, package metadata and notices. It excludes dist,
local project data, environment files and repository credentials. SOURCE.json
records each file's SHA-256 and the visible algorave build ID; BUILD.txt describes
rebuilding with the pinned npm dependency lock. The archive is generated from the
same working files as the browser bundle, rather than a potentially older HEAD.
The source snapshot is available beside the bundle even when GitHub is unavailable.

The updated owner goal explicitly requests public web deployment. That request
does not authorize desktop reinstallation, broadcast changes or a license change
to existing source files. The earlier six provider calls were separately authorized.
Native Safari, sustained performance, asset handling and live-provider acceptance
remain separate goal requirements. Preserve this record in the release review.
