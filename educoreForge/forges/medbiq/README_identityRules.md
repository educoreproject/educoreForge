# MedBiquitous: identity rules

The rules belong to `lib/xsd-forge/xsdIdentity.js`; this bundle's prefix is `medbiq:`. They key on the NAMESPACE, never the file. Two
files of one namespace share one identity space, and a name defined twice in it refuses.

| Node | stableId | Example |
|---|---|---|
| root | `medbiq:root` | |
| schema file | `medbiq:schemaFile/<repository path>` | `medbiq:schemaFile/member/v2/member.xsd` |
| top-level definition | `medbiq:<symbol space>/<namespace path>#<name>`; symbol space: `type` (complexType and simpleType), `element`, `group`, `attributeGroup` | `medbiq:type/ns.medbiq.org/curriculuminventory/v2#SequenceBlockType` |
| field | `<owner id>/el|attr|elRef|attrRef/<name>` | `…#VocabularyTermType/attr/source` |
| anonymous type | `<declaration id>/anon` | |
| enumeration value | `<option set id>/code/<value>`; characters outside `[A-Za-z0-9@_$.:-]` are percent-encoded; the name stays verbatim | |

The namespace path is the namespace URI without `http://` and its trailing slash. The IEEE LOM binding's ids therefore name IEEE's namespace, `medbiq:type/ltsc.ieee.org/xsd/LOM#…`. Its prefix is `medbiq:` only because MedBiquitous ships the files.

An element `ref=` field is named for the local part of what it references. Its id segment is `elRef`, so it can never collide with a local element of the same name.
