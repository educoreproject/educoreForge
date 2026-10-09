# README_PROVENANCE — PESC College Transcript v1.7.0

Written by `lib/pesc-release-forge/tools/scaffoldReleaseBundle.js` on 2026-10-09. Not machine-checked; the bytes are checked
by `SHA256SUMS` (the framework, before every forge) and by `releaseManifestEntry.json` (loader 2).

| what | value |
|---|---|
| release | CollegeTranscript_v1.7.0 (standard CollegeTranscript, version 1.7.0) |
| expander verdict | clean |
| closure digest | 813716840bed77c0601d9610a0cbf875662e3b709a54f01d7ee8c3e366c371d0 |
| closure date | 2016-09-09 |
| source corpus digest | a060538b87eda9644de043f56f6f7a3cb81e80765b4e8f19570e6662298fec66 |
| expander manifest format | pescReleaseExpander/1 |
| expander code | /Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code at commit b0811e1aca2f2cb3919022a496683c1d056beb38 (clean working tree) |
| copied from | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/CollegeTranscript_v1.7.0` |
| manifest | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json` |

The release folder is pescReleaseExpander's closure of one PESC message schema over the exact library
files it names. It is ours, never a PESC artifact. Each .xsd file was copied byte for byte
(COPYFILE_EXCL) and never edited. `releaseManifestEntry.json` holds the release's entry from
`releaseManifest.json`, verbatim, under `releaseEntry`, and two manifest-level facts under
`copiedFromManifest`.

The command:

```
node lib/pesc-release-forge/tools/scaffoldReleaseBundle.js --releaseFolder=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/CollegeTranscript_v1.7.0 --manifest=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json --outputRoot=forges --expanderCodeDir=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code
```

Files:

| sha256 | file |
|---|---|
| 76ef93896303b613c2000bb1b565c433d021bec0a2c31e9f91389af3e3ad4487 | AcademicRecord_v1.11.0.xsd |
| b92fe35d126390825ce92cc83c430fd33fadb7dd3c810dc03abd2bb1cad4ccd6 | CollegeTranscript_v1.7.0.xsd |
| f4b05efd5839528d316dc6f58c3dfd3d623767b53c82d918198c57fa25f840c7 | CoreMain_v1.17.0.xsd |
| 3634b533ecc9db84190abb5648840ad54967a0474941f3de6a3f638f70c29772 | iso_3166-1_v1.0.0.xsd |
| 31c1fc879dd4ce431311760260d0d5cfd97e67f5212067f43970021a302e44b3 | releaseManifestEntry.json |
