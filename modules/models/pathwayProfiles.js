export const PATHWAY_PROFILE_SCALING = {
    mystic: {
        9: {spirituality: 2, integrity: 8},
        8: {spirituality: 4, integrity: 8},
        7: {spirituality: 6, integrity: 10},
        6: {spirituality: 8, integrity: 10},
        5: {spirituality: 10, integrity: 10},
        4: {spirituality: 12, integrity: 15},
        3: {spirituality: 14, integrity: 15},
        2: {spirituality: 16, integrity: 15},
        1: {spirituality: 18, integrity: 15},
        0: {spirituality: 20, integrity: 20}
    },

    mixed: {
        9: {spirituality: 1, integrity: 8},
        8: {spirituality: 3, integrity: 9},
        7: {spirituality: 5, integrity: 10},
        6: {spirituality: 7, integrity: 11},
        5: {spirituality: 9, integrity: 12},
        4: {spirituality: 11, integrity: 15},
        3: {spirituality: 13, integrity: 16},
        2: {spirituality: 15, integrity: 17},
        1: {spirituality: 17, integrity: 18},
        0: {spirituality: 20, integrity: 20}
    },

    corporeal: {
        9: {spirituality: 1, integrity: 8},
        8: {spirituality: 2, integrity: 10},
        7: {spirituality: 3, integrity: 12},
        6: {spirituality: 5, integrity: 13},
        5: {spirituality: 7, integrity: 14},
        4: {spirituality: 9, integrity: 16},
        3: {spirituality: 12, integrity: 17},
        2: {spirituality: 15, integrity: 18},
        1: {spirituality: 18, integrity: 19},
        0: {spirituality: 20, integrity: 20}
    }
};

/**
 * Returns the spirituality and integrity maximums for a profile
 * at a given sequence.
 *
 * @param {string} profile - "mystic", "mixed", or "corporeal"
 * @param {number|string} sequence - Sequence number from 0 to 9
 * @returns {{spirituality: number, integrity: number}|null}
 */
export function getPathwayProfileScaling(profile, sequence) {
    const profileData = PATHWAY_PROFILE_SCALING[profile?.toLowerCase()];
    const sequenceData = profileData?.[Number(sequence)];

    return sequenceData ? {...sequenceData} : null;
}