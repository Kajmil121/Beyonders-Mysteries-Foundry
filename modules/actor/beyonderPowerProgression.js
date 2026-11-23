function collectionContents(collection) {
    if (!collection) return [];
    if (Array.isArray(collection.contents)) return collection.contents;
    return Array.from(collection.values?.() ?? collection);
}

function normalizeName(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
}

/**
 * Loads Beyonder Power source Items from the World and Item compendiums.
 * Owned copies on Actors are deliberately excluded from the source list.
 */
async function getAvailableBeyonderPowers() {
    const sources = new Map();

    for (const item of collectionContents(game.items)) {
        if (item.type === "BeyonderPower") {
            sources.set(item.uuid, item);
        }
    }

    for (const pack of collectionContents(game.packs)) {
        if (pack.documentName !== "Item") continue;

        try {
            // Ask the compendium directly for only this custom Item type.
            const documents = await pack.getDocuments({type:"BeyonderPower"});
            for (const item of documents) {
                if (item.type === "BeyonderPower") {
                    sources.set(item.uuid, item);
                }
            }
        } catch (error) {
            console.warn(`Beyond | Could not read Beyonder Powers from ${pack.collection}`, error);
        }
    }

    return [...sources.values()];
}

/**
 * Grants all unowned powers from the character's Pathway that have been
 * reached. A power assigned to Sequence 9 is gained upon reaching Sequence 8,
 * so the source sequence number must be greater than the character's number.
 *
 * Example: a character at Sequence 5 receives powers assigned to 9, 8, 7 and 6.
 * Granted powers remain on the Actor if the sequence is later changed backwards.
 */
export async function grantEligibleBeyonderPowers(actor, {includeCurrentSequence = false} = {}) {
    if (!actor || actor.documentName !== "Actor") return [];

    const pathwayName = actor.system.pathway?.pathway?.name;
    const currentSequence = actor.system.pathway?.sequence?.number;
    const normalizedPathway = normalizeName(pathwayName);
    const sequenceNumber = Number(currentSequence);

    if (
        !normalizedPathway ||
        currentSequence === null ||
        currentSequence === undefined ||
        currentSequence === "" ||
        !Number.isInteger(sequenceNumber) ||
        sequenceNumber < 0 ||
        sequenceNumber > 9
    ) {
        return [];
    }

    const removedSourceUuids = new Set(
        actor.getFlag("Beyond", "removedBeyonderPowerSources") ?? []
    );
    const removedPowerKeys = new Set(
        actor.getFlag("Beyond", "removedBeyonderPowerKeys") ?? []
    );

    const ownedPowers = actor.items.filter(item => item.type === "BeyonderPower");
    const ownedSourceUuids = new Set(
        ownedPowers
            .map(item => item.flags?.Beyond?.pathwayPowerGrant?.sourceUuid)
            .filter(Boolean)
    );
    const ownedPowerKeys = new Set(ownedPowers.map(item => [
        normalizeName(item.system.pathwayName),
        Number(item.system.sequence),
        normalizeName(item.name)
    ].join("|")));

    const sourcePowers = await getAvailableBeyonderPowers();
    const toCreate = [];

    for (const source of sourcePowers) {
        const sourcePathway = normalizeName(source.system.pathwayName);
        const sourceSequence = Number(source.system.sequence);

        if (sourcePathway !== normalizedPathway) continue;
        const sequenceIsEligible = includeCurrentSequence
            ? sourceSequence >= sequenceNumber
            : sourceSequence > sequenceNumber;
        if (!Number.isInteger(sourceSequence) || !sequenceIsEligible || sourceSequence > 9) continue;
        if (ownedSourceUuids.has(source.uuid) || removedSourceUuids.has(source.uuid)) continue;

        const powerKey = [
            sourcePathway,
            sourceSequence,
            normalizeName(source.name)
        ].join("|");
        if (ownedPowerKeys.has(powerKey) || removedPowerKeys.has(powerKey)) continue;

        const itemData = source.toObject();
        delete itemData._id;

        itemData.flags ??= {};
        itemData.flags.Beyond = {
            ...(itemData.flags.Beyond ?? {}),
            pathwayPowerGrant: {
                sourceUuid:source.uuid,
                pathwayName,
                sequence:sourceSequence,
                granted:true
            }
        };

        toCreate.push(itemData);
        ownedSourceUuids.add(source.uuid);
        ownedPowerKeys.add(powerKey);
    }

    if (!toCreate.length) return [];

    const created = await actor.createEmbeddedDocuments("Item", toCreate);
    return created;
}
