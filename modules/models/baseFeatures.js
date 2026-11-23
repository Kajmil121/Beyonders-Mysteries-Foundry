
export class AttributesDM extends foundry.abstract.DataModel {
    static defineSchema() {
        const fields = foundry.data.fields;
        const baseInt = {required: true, nullable: false, integer: true};

        const importanceValue = {blank: true,
            choices: {
                Primary: "Beyond.Actor.AttributeOptions.primary",
                Secondary: "Beyond.Actor.AttributeOptions.secondary",
                Tertiary: "Beyond.Actor.AttributeOptions.tertiary"
            }
        };

        const makeAttribute = () => {
            return new fields.SchemaField({
                value: new fields.NumberField({...baseInt, initial: 1, min: 0, max:10}),
                bonus: new fields.NumberField({...baseInt, initial: 0}),
                max: new fields.NumberField({...baseInt, initial: 5, min: 0, max: 10}),
                max: new fields.NumberField({...baseInt, initial: 5, min: 0, max: 10}),
                baseCap: new fields.NumberField({...baseInt, initial: 5, min: 0, max: 10}),
                cap: new fields.NumberField({...baseInt, initial: 5, min: 0, max: 10}),

                advancements: new fields.SchemaField({
                active: new fields.BooleanField({required:true, nullable:false, initial:false}),
                originSequence: new fields.NumberField({integer:true, initial:9, min:0, max:9}),
                levelsGained: new fields.NumberField({integer:true, initial:0, min:0, max:5}),
                pathwayLevels: new fields.NumberField({required:true, nullable:false, integer:true, initial:0, min:0, max:10}),
                pathwayCeiling: new fields.NumberField({required:true, nullable:true, integer:true, initial:null, min:1, max:10})
            })
            });
        };

        const makeCategory = (attributes) => {
            const attributesFields = Object.fromEntries(
                attributes.map((attr) => [attr, makeAttribute()])
            );

            return new fields.SchemaField({
                importance: new fields.StringField(importanceValue),
                ...attributesFields
            });
        };

        return {
            physical: makeCategory(["strength", "dexterity", "stamina"]),
            social: makeCategory(["presence", "manipulation", "appearance"]),
            mental: makeCategory(["perception", "intelligence", "wisdom"]),

            locked: new fields.BooleanField({required: true, initial: false})
        };
    }
    static validateJoint(data) {
        for (const categoryName of ["physical", "social", "mental"]) {
            const category = data[categoryName];
            if (!category) continue;

            for (const [attributeName, attribute] of Object.entries(category)) {
                if (attributeName === "importance") continue;

                const advancement = attribute.advancements;
                const normalLevels = advancement?.active ? Number(advancement.levelsGained ?? 0) : 0;
                const pathwayLevels = Number(advancement?.pathwayLevels ?? 0);

                let limit = Math.min(10, Number(attribute.baseCap ?? 0) + normalLevels + pathwayLevels);

                const ceiling = advancement?.pathwayCeiling;
                if (ceiling !== null && ceiling !== undefined) {
                    limit = Math.min(limit, Number(ceiling));
                }

                if (attribute.value > limit) {
                    throw new Error(`${attributeName} score cannot exceed ${limit}`);
                }
            }
        }
    }
}

export class HealthDM extends foundry.abstract.DataModel {
    static defineSchema() {
        const fields = foundry.data.fields;
        const valueString = {required: true, nullable: false, initial: ""};
        const positiveInteger = {required: true, nullable: false, integer: true, initial: 0, min: 0};
        const healthValue = {required: true, nullable: false, integer: true, initial: 1, min: 0};
        const bonusInteger = {required: true, nullable: false, integer: true, initial: 0};

        return {
            integrity: new fields.SchemaField({
                max: new fields.NumberField({required: true, nullable: false, integer: true, initial: 6, min: 0, max: 20}),
                value: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0})
            }),

            damage: new fields.SchemaField({
                bashing: new fields.NumberField({...positiveInteger}),
                lethal: new fields.NumberField({...positiveInteger}),
                aggravated: new fields.NumberField({...positiveInteger}),
                woundlevel: new fields.StringField({...valueString}),
                woundpenalty: new fields.NumberField({...bonusInteger})
            }),

            unharmed: new fields.SchemaField({
                value: new fields.NumberField({...healthValue}),
                total: new fields.NumberField({...healthValue}),
                penalty: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0}),
                label: new fields.StringField({required: true, nullable: false, initial: "Beyond.Health.unharmed"})
            }),

            bruised: new fields.SchemaField({
                value: new fields.NumberField({...healthValue}),
                total: new fields.NumberField({...healthValue}),
                penalty: new fields.NumberField({required: true, nullable: false, integer: true, initial: -1}),
                label: new fields.StringField({required: true, nullable: false, initial: "Beyond.Health.bruised"})
            }),

            wounded: new fields.SchemaField({
                value: new fields.NumberField({...healthValue}),
                total: new fields.NumberField({...healthValue}),
                penalty: new fields.NumberField({required: true, nullable: false, integer: true, initial: -2}),
                label: new fields.StringField({required: true, nullable: false, initial: "Beyond.Health.wounded"})
            }),

            badly: new fields.SchemaField({
                value: new fields.NumberField({...healthValue}),
                total: new fields.NumberField({...healthValue}),
                penalty: new fields.NumberField({required: true, nullable: false, integer: true, initial: -3}),
                label: new fields.StringField({required: true, nullable: false, initial: "Beyond.Health.badly"})
            }),

            crippled: new fields.SchemaField({
                value: new fields.NumberField({...healthValue}),
                total: new fields.NumberField({...healthValue}),
                penalty: new fields.NumberField({required: true, nullable: false, integer: true, initial: -5}),
                label: new fields.StringField({required: true, nullable: false, initial: "Beyond.Health.crippled"})
            }),

            incapacitated: new fields.SchemaField({
                value: new fields.NumberField({...healthValue}),
                total: new fields.NumberField({...healthValue}),
                penalty: new fields.NumberField({required: true, nullable: false, integer: true, initial: -99}),
                label: new fields.StringField({required: true, nullable: false, initial: "Beyond.Health.incapacitated"})
            })
        };
    }
    static validateJoint(data) {
    const integrity = data.integrity;

    if (!integrity) return;

    if (integrity.value > integrity.max) {
        throw new Error(
            `Integrity cannot exceed its maximum of ${integrity.max}`
        );
    }
    }
}

export class DeterminationDM extends foundry.abstract.DataModel {
    static defineSchema() {
        const fields = foundry.data.fields;

        return {
            determination: new fields.SchemaField({
                max: new fields.NumberField({required: true, nullable: false, integer: true, initial: 1, min: 0, max: 10}),
                temp: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0, max: 10})
            }),
            stability: new fields.SchemaField({
                value: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0, max: 7}),
                history: new fields.ArrayField(
                    new fields.SchemaField({
                        trigger: new fields.StringField({required: true, initial: ""}),
                        baseDifficulty: new fields.NumberField({required: true, integer: true, min: 1, max: 10, initial: 6}),
                        difficulty: new fields.NumberField({required: true, integer: true, min: 1, max: 10, initial: 6}),
                        exposure: new fields.NumberField({required: true, integer: true, min: 1, initial: 1}),
                        pool: new fields.NumberField({required: true, integer: true, min: 0, initial: 0}),
                        successes: new fields.NumberField({required: true, integer: true, min: 0, initial: 0}),
                        passed: new fields.BooleanField({required: true, initial: false}),
                        outcome: new fields.StringField({required: true, initial: ""}),
                        outcomeAmount: new fields.NumberField({required: true, integer: true, min: 0, max: 10, initial: 0}),
                        timestamp: new fields.NumberField({required: true, integer: true, min: 0, initial: 0})
                    }),
                    {initial: []}
                )
            }),
            control: new fields.SchemaField({
                value: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0, max: 4})
            }),
            transgressions: new fields.SchemaField({
                value: new fields.NumberField({required: true, nullable: true, integer: true, initial: null, min: 0, max: 10}),
                residuePending: new fields.BooleanField({required: true, initial: false})
            }),
            locked: new foundry.data.fields.BooleanField({initial: true})
        };
    }
}

export class AbilitiesDM extends foundry.abstract.DataModel {
    static defineSchema() {
        const fields = foundry.data.fields;
        const baseInt = {required: true, nullable: false, integer: true};

        const importanceValue = {
            blank: true,
            choices: {
                Primary: "Beyond.Actor.AbilityOptions.primary",
                Secondary: "Beyond.Actor.AbilityOptions.secondary",
                Tertiary: "Beyond.Actor.AbilityOptions.tertiary"
            }
        };

        const makeAbility = (dangerous = false) => {
            return new fields.SchemaField({
                value: new fields.NumberField({...baseInt, initial: 0, min: 0}),
                bonus: new fields.NumberField({...baseInt, initial: 0}),
                max: new fields.NumberField({...baseInt, initial: 5, min: 0}),
                dangerous: new fields.BooleanField({required: true, initial: dangerous})
            });
        };

        const makeCategory = (abilities, dangerousAbilities = []) => {
            const abilityFields = Object.fromEntries(
                abilities.map(abil => [abil, makeAbility(dangerousAbilities.includes(abil))])
            );

            return new fields.SchemaField({
                importance: new fields.StringField(importanceValue),
                ...abilityFields
            });
        };

        return {
            talents: makeCategory([
                "Initiative", "Athletics", "Brawl", "Dodge", "Empathy",
                "Expression", "Intimidation", "Leadership", "SleightofHand",
                "Subterfuge"
            ]),

            skills: makeCategory([
                "Crafts", "Drive", "Etiquette", "Firearms", "Meditation",
                "Melee", "Performance", "Stealth", "Survival", "Machinery"
            ]),

            knowledges: makeCategory([
            "Academics", "engineering", "Cosmology", "Enigmas",
            "Investigation", "Law", "linguistics", "Medicine",
            "Mysticism", "Occult"
            ], ["Cosmology", "Mysticism", "Occult"]),

            locked: new fields.BooleanField({required: true, initial: false})
        };
    }
}

export class PathwayDM extends foundry.abstract.DataModel {
    static defineSchema() {
        const fields = foundry.data.fields;

        return {
            pathway: new fields.SchemaField({
                name: new fields.StringField({blank: true}),
                profile: new fields.StringField({}),
                group: new fields.StringField({}),
                authority: new fields.StringField({}),
                primaryAttribute: new fields.StringField({}),
                secondaryAttribute: new fields.StringField({})
            }),

            actingMethod: new fields.StringField({initial: ""}),
            anchors: new fields.StringField({initial: ""}),

            sequence: new fields.SchemaField({
                number: new fields.NumberField({required: true, nullable: true, integer: true, initial: null, max: 9, min: 0}),
                name: new fields.StringField({}),
                digestion: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0, max: 100}),
                digestionOverflow: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0, max: 19}),
                sequencePoints: new fields.NumberField({required: true, nullable: false, integer: true, initial: 1, min: 1, max: 10})
            }),

            tier: new fields.StringField({
                required: true,
                blank: false,
                initial: "Mundane",
                choices: {
                    Mundane: "Beyond.Actor.Tiers.mundane",
                    Low: "Beyond.Actor.Tiers.low",
                    Mid: "Beyond.Actor.Tiers.mid",
                    High: "Beyond.Actor.Tiers.high",
                    Above: "Beyond.Actor.Tiers.above"
                }
            }),

            spirituality: new fields.SchemaField({
                max: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0, max: 20}),
                value: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0, min: 0})
            })
        };
    }
    static validateJoint(data) {
    const spirituality = data.spirituality;

    if (!spirituality) return;

    if (spirituality.value > spirituality.max) {
        throw new Error(
            `Spirituality cannot exceed its current maximum of ${spirituality.max}`
        );
    }
    }
}

export class BackgroundsDM extends foundry.abstract.DataModel{
    static defineSchema() {
        const fields = foundry.data.fields;

        const backgroundField = () => new fields.SchemaField({
            value: new fields.NumberField({required: true,initial: 0,min: 0,max: 5,integer: true}),
            legendary: new fields.NumberField({required: true,initial: 0,min: 0,max: 5,integer: true})
        });

        return {
            allies: backgroundField(),
            contacts: backgroundField(),
            spirituality: backgroundField(),
            inheritance: backgroundField(),
            beyonderOrganization: backgroundField(),
            influence: backgroundField(),
            mentor: backgroundField(),
            resources: backgroundField(),

            locked: new fields.BooleanField({required: true, initial: false})
        };
    }
}
