
const fields = foundry.data.fields;

/**
 * Automatically determines the tier from a sequence.
 */
export function getSequenceTier(sequence) {
    if (sequence === null || sequence === undefined || sequence === "") {
        return "Mundane";
    }

    const number = Number(sequence);

    if (!Number.isInteger(number) || number < 0 || number > 9) {
        return null;
    }

    if (number === 0) return "True God";
    if (number >= 8) return "Low Sequence";
    if (number >= 5) return "Mid Sequence";

    return "High Sequence";
}

export const BEYOND_THE_SEQUENCES_TIER = "Beyond The Sequences";

/**
 * Individual attribute advancement.
 *
 * levels = additional attribute levels granted
 * ceiling = absolute attribute ceiling after reaching this sequence
 */
function createAttributeAdvancementField() {
    return new fields.SchemaField({
        levels: new fields.NumberField({
            integer: true,
            min: 0,
            max: 10,
            initial: 0
        }),

        ceiling: new fields.NumberField({
            integer: true,
            min: 1,
            max: 10,
            nullable: true,
            initial: null
        })
    });
}

/**
 * Attribute advancement groups for each sequence.
 */
function createAttributeAdvancementsSchema() {
    return {
        physical: new fields.SchemaField({
            strength: createAttributeAdvancementField(),
            dexterity: createAttributeAdvancementField(),
            stamina: createAttributeAdvancementField()
        }),

        social: new fields.SchemaField({
            presence: createAttributeAdvancementField(),
            manipulation: createAttributeAdvancementField(),
            appearance: createAttributeAdvancementField()
        }),

        mental: new fields.SchemaField({
            perception: createAttributeAdvancementField(),
            intelligence: createAttributeAdvancementField(),
            wisdom: createAttributeAdvancementField()
        })
    };
}

/**
 * Creates default entries from Sequence 9 to Sequence 0.
 */
function createDefaultSequences() {
    return Array.from({length: 10}, (_, index) => ({
        number: 9 - index,
        name: "",
        attributeAdvancements: {
            physical: {
                strength: {levels: 0, ceiling: null},
                dexterity: {levels: 0, ceiling: null},
                stamina: {levels: 0, ceiling: null}
            },

            social: {
                presence: {levels: 0, ceiling: null},
                manipulation: {levels: 0, ceiling: null},
                appearance: {levels: 0, ceiling: null}
            },

            mental: {
                perception: {levels: 0, ceiling: null},
                intelligence: {levels: 0, ceiling: null},
                wisdom: {levels: 0, ceiling: null}
            }
        }
    }));
}

/**
 * Pathway Item DataModel.
 */
export class PathwayItemData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            locked: new fields.BooleanField({
                initial: true
            }),

            profile: new fields.StringField({
                choices: {
                    mystic: "Mystic",
                    mixed: "Mixed",
                    corporeal: "Corporeal"
                },
                initial: "mystic",
                required: true
            }),

            authorities: new fields.StringField({
                initial: ""
            }),

            sequences: new fields.ArrayField(
                new fields.SchemaField({
                    number: new fields.NumberField({
                        integer: true,
                        min: 0,
                        max: 9,
                        initial: 9,
                        required: true
                    }),

                    name: new fields.StringField({
                        initial: ""
                    }),

                    attributeAdvancements: new fields.SchemaField(
                        createAttributeAdvancementsSchema()
                    )
                }),
                {
                    initial: createDefaultSequences,
                    required: true
                }
            )
        };
    }
}
