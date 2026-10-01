# README_PROVENANCE — PESC College Transcript v1.8.0

Written by `lib/pesc-release-forge/tools/scaffoldReleaseBundle.js` on 2026-10-01. Not machine-checked; the bytes are checked
by `SHA256SUMS` (the framework, before every forge) and by `releaseManifestEntry.json` (loader 2).

| what | value |
|---|---|
| release | CollegeTranscript_v1.8.0 (standard CollegeTranscript, version 1.8.0) |
| expander verdict | clean |
| closure digest | e45aebb6e060d1931da5891290412a15bbfb934dddf19abf4e7ac0ca8f23e93a |
| closure date | 2016-09-09 |
| source corpus digest | a060538b87eda9644de043f56f6f7a3cb81e80765b4e8f19570e6662298fec66 |
| expander manifest format | pescReleaseExpander/1 |
| expander code | /Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code at commit b0811e1aca2f2cb3919022a496683c1d056beb38 (clean working tree) |
| copied from | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/CollegeTranscript_v1.8.0` |
| manifest | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json` |

The release folder is pescReleaseExpander's closure of one PESC message schema over the exact library
files it names. It is ours, never a PESC artifact. Each .xsd file was copied byte for byte
(COPYFILE_EXCL) and never edited. `releaseManifestEntry.json` holds the release's entry from
`releaseManifest.json`, verbatim, under `releaseEntry`, and two manifest-level facts under
`copiedFromManifest`.

The command:

```
node lib/pesc-release-forge/tools/scaffoldReleaseBundle.js --releaseFolder=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/CollegeTranscript_v1.8.0 --manifest=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json --outputRoot=forges --expanderCodeDir=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code
```

Files:

| sha256 | file |
|---|---|
| 971970f7ff62de32fe3c1e36df32ff81f111ee703439bd4c7e4ba32a28a1dcb0 | AcademicRecord_v1.13.0.xsd |
| 53430176920c55a0431bdc166db326d0b96b564f86d8114bfb01459b0ee15502 | CollegeTranscript_v1.8.0.xsd |
| d9ded3484f893672cdb9fff07f5401231661e33870f9427489bcc02188c3d60a | CoreMain_v1.19.0.xsd |
| 3634b533ecc9db84190abb5648840ad54967a0474941f3de6a3f638f70c29772 | iso_3166-1_v1.0.0.xsd |
| 0fb6cc08a3b9cf169dfa0ecb7c6892b42ea51d65d583923d77db8bd2ef776ddf | releaseManifestEntry.json |
