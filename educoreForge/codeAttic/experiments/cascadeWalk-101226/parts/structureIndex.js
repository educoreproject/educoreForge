'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// structureIndex.js — CEDS's published structure as the walks need it, read ONCE per run, READ-ONLY, from the gold:
//   the Conceptual Model (guide layer): 8 concepts, and each class's primary and secondary concepts;
//   the Version 13 Domain Entity Schema (des layer): 13 domains, 75 entities, and the V14 properties each entity's
//   placements reach (through any depth of categories);
//   the base classes' names and definitions (the class-choice options);
//   and, from the bridge's own card slot index, which property-tier cards hang on each class and each property.
// The layer reads are the harness's own (the bridge reader deliberately does not expose StandardLayer nodes); they run
// in a READ session, so the driver itself refuses a write.

const neo4j = require('neo4j-driver');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

// STRUCTURE_READ_LIST — one row per read: its name in the index, and its Cypher. Every read returns plain rows.
const STRUCTURE_READ_LIST = Object.freeze([
	{ readName: 'conceptRowList', cypher: 'MATCH (c:CedsConceptualConcept) RETURN c.stableId AS conceptStableId, c.name AS name, c.definition AS definition ORDER BY c.conceptOrdinal' },
	{ readName: 'classConceptRowList', cypher: 'MATCH (cl:CedsClass)-[r:HAS_PRIMARY_CONCEPT|HAS_SECONDARY_CONCEPT]->(c:CedsConceptualConcept) RETURN cl.stableId AS classStableId, c.stableId AS conceptStableId, type(r) AS membershipKind' },
	{ readName: 'classRowList', cypher: 'MATCH (cl:CedsClass) WHERE NOT cl:StandardLayer RETURN cl.stableId AS classStableId, cl.name AS name, cl.definition AS definition ORDER BY cl.stableId' },
	{ readName: 'desDomainRowList', cypher: 'MATCH (d:CedsDesDomain) RETURN d.stableId AS desDomainStableId, d.name AS name ORDER BY d.name' },
	{ readName: 'desEntityRowList', cypher: 'MATCH (d:CedsDesDomain)-[:HAS_DES_ENTITY]->(e:CedsDesEntity) RETURN d.stableId AS desDomainStableId, d.name AS desDomainName, e.stableId AS desEntityStableId, e.name AS name ORDER BY e.stableId' },
	{ readName: 'desEntityPropertyRowList', cypher: 'MATCH (e:CedsDesEntity)-[:HAS_DES_CATEGORY*0..10]->(area)-[:HAS_DES_PLACEMENT]->(pl:CedsDesPlacement)-[:PLACES_PROPERTY]->(p:CedsProperty) RETURN e.stableId AS desEntityStableId, collect(DISTINCT p.stableId) AS propertyStableIdList' },
	{ readName: 'placedPropertyRowList', cypher: 'MATCH (:CedsDesPlacement)-[:PLACES_PROPERTY]->(p:CedsProperty) RETURN DISTINCT p.stableId AS propertyStableId' },
	{ readName: 'basePropertyRowList', cypher: 'MATCH (p:CedsProperty) WHERE NOT p:StandardLayer RETURN p.stableId AS propertyStableId' },
]);

const readRows = ({ session, cypher }, callback) => {
	session
		.run(cypher)
		.then((result) => callback('', result.records.map((oneRecord) => oneRecord.keys.reduce((soFar, oneColumn) => Object.assign(soFar, { [oneColumn]: oneRecord.get(oneColumn) }), {}))))
		.catch((runError) => callback(`${moduleName}: ${runError.message}`));
};

const groupInto = (rowList, groupFieldName, memberFieldName) =>
	rowList.reduce((soFar, oneRow) => {
		(soFar[oneRow[groupFieldName]] = soFar[oneRow[groupFieldName]] || []).push(oneRow[memberFieldName]);
		return soFar;
	}, {});

// cardIndexFor — which property-tier cards hang on each class (domain slot) and on each property (property slot),
// from the bridge's OWN cardSlotIndex (candidateRetrieval.buildCardSlotIndex), so a walk addresses the same cards A0 does.
// buildCardSlotIndex gives every card all three slot lists (empty when unfilled), so they are read bare.
const cardIndexFor = ({ cardSlotIndex }) => {
	const cardStableIdListByClassStableId = {};
	const cardStableIdListByPropertyStableId = {};
	const propertyStableIdListByCardStableId = {};
	const classStableIdListByCardStableId = {};
	cardSlotIndex.baseStableIdListBySlotKindByCardStableId.forEach((baseListBySlotKind, cardStableId) => {
		baseListBySlotKind.domain.forEach((classStableId) => (cardStableIdListByClassStableId[classStableId] = cardStableIdListByClassStableId[classStableId] || []).push(cardStableId));
		baseListBySlotKind.property.forEach((propertyStableId) => (cardStableIdListByPropertyStableId[propertyStableId] = cardStableIdListByPropertyStableId[propertyStableId] || []).push(cardStableId));
		propertyStableIdListByCardStableId[cardStableId] = baseListBySlotKind.property.slice();
		classStableIdListByCardStableId[cardStableId] = baseListBySlotKind.domain.slice();
	});
	return { cardStableIdListByClassStableId, cardStableIdListByPropertyStableId, propertyStableIdListByCardStableId, classStableIdListByCardStableId };
};

const buildStructureIndex = ({ inGraph, cardSlotIndex }, callback) => {
	const driver = neo4j.driver(inGraph.boltUrl, neo4j.auth.basic(inGraph.user, inGraph.password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const taskList = new taskListPlus();
	STRUCTURE_READ_LIST.forEach((oneRead) => {
		taskList.push((args, next) => readRows({ session, cypher: oneRead.cypher }, (readError, rowList) => (readError ? next(`${oneRead.readName}: ${readError}`) : next('', { ...args, [oneRead.readName]: rowList }))));
	});
	pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
		session.close().then(() => driver.close()).then(() => {
			if (pipelineError) {
				callback(pipelineError);
				return;
			}
			const placedPropertyStableIdSet = new Set(args.placedPropertyRowList.map((oneRow) => oneRow.propertyStableId));
			const unplacedPropertyStableIdSet = new Set(args.basePropertyRowList.map((oneRow) => oneRow.propertyStableId).filter((oneStableId) => !placedPropertyStableIdSet.has(oneStableId)));
			const cardIndex = cardIndexFor({ cardSlotIndex });
			callback('', {
				conceptList: args.conceptRowList,
				classStableIdListByConceptStableId: groupInto(args.classConceptRowList, 'conceptStableId', 'classStableId'),
				classByStableId: args.classRowList.reduce((soFar, oneRow) => Object.assign(soFar, { [oneRow.classStableId]: oneRow }), {}),
				desDomainList: args.desDomainRowList,
				desEntityListByDomainStableId: args.desEntityRowList.reduce((soFar, oneRow) => {
					(soFar[oneRow.desDomainStableId] = soFar[oneRow.desDomainStableId] || []).push(oneRow);
					return soFar;
				}, {}),
				propertyStableIdListByDesEntityStableId: args.desEntityPropertyRowList.reduce((soFar, oneRow) => Object.assign(soFar, { [oneRow.desEntityStableId]: oneRow.propertyStableIdList }), {}),
				unplacedPropertyStableIdSet,
				cardStableIdListByClassStableId: cardIndex.cardStableIdListByClassStableId,
				cardStableIdListByPropertyStableId: cardIndex.cardStableIdListByPropertyStableId,
				propertyStableIdListByCardStableId: cardIndex.propertyStableIdListByCardStableId,
				classStableIdListByCardStableId: cardIndex.classStableIdListByCardStableId,
			});
		});
	});
};

module.exports = { buildStructureIndex, moduleName };
