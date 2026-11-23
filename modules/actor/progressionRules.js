export function getStabilityValue(actor) {
    return Math.min(7, Math.max(0, Math.trunc(Number(actor?.system?.determination?.stability?.value) || 0)));
}

export function getEffectiveDeterminationMax(actor, baseMaximum = null) {
    const base = baseMaximum === null
        ? actor?.system?.determination?.determination?.max
        : baseMaximum;
    const maximum = Math.min(10, Math.max(0, Math.trunc(Number(base) || 0)));
    const stability = getStabilityValue(actor);
    return stability > 0 ? Math.max(0, maximum - stability) : maximum;
}

export function getAvailableDeterminationMaximum(actor, baseMaximum = null) {
    if (getStabilityValue(actor) >= 7) return 0;
    return getEffectiveDeterminationMax(actor, baseMaximum);
}

export function getTransgressionValue(actor) {
    const raw = actor?.system?.determination?.transgressions?.value;
    if (raw === null || raw === undefined || raw === "") return null;
    return Math.min(10, Math.max(0, Math.trunc(Number(raw) || 0)));
}

export function getSequenceDifficultyPenalty(actor) {
    const transgressions = getTransgressionValue(actor);
    return transgressions !== null && transgressions >= 3 && transgressions <= 4 ? 1 : 0;
}

export function getLossOfControlDifficultyPenalty(actor) {
    return getSequenceDifficultyPenalty(actor);
}

export function getStabilityPoolPenalty(actor, attributeKey) {
    const stability = getStabilityValue(actor);
    const keyParts = String(attributeKey ?? "").split(".");
    const attribute = keyParts.at(-1);
    const category = keyParts.length > 1
        ? keyParts[0]
        : ["presence", "manipulation", "appearance"].includes(attribute)
            ? "social"
            : ["perception", "intelligence", "wisdom"].includes(attribute)
                ? "mental"
                : ["strength", "dexterity", "stamina"].includes(attribute)
                    ? "physical"
                    : "";

    if (stability >= 5 && ["mental", "social"].includes(category)) return -3;
    if (stability >= 3 && ["mental", "social"].includes(category)) return -2;
    if (stability >= 2 && category === "mental" && ["perception", "wisdom"].includes(attribute)) return -1;
    return 0;
}

export function getSequenceStabilityPoolPenalty(actor) {
    return getStabilityValue(actor) >= 5 ? -1 : 0;
}
