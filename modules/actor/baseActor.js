import {AttributesDM,HealthDM,DeterminationDM,AbilitiesDM,PathwayDM} 
from "../models/baseFeatures.js";

export class BaseActor extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        const fields = foundry.data.fields;

        return {
            attributes: new fields.EmbeddedDataField(AttributesDM),
            health: new fields.EmbeddedDataField(HealthDM),
            determination: new fields.EmbeddedDataField(DeterminationDM),
            abilities: new fields.EmbeddedDataField(AbilitiesDM),
            pathway: new fields.EmbeddedDataField(PathwayDM),
            details: new fields.SchemaField({
                playerName: new fields.StringField({initial: ""}),
                archetype: new fields.StringField({initial: ""}),
                organization: new fields.StringField({initial: ""}),
                honorificName: new fields.StringField({initial: ""}),
                totalExperience: new fields.NumberField({required: true, integer: true, initial: 0, min: 0})
            })
        };
    }

    static validateJoint(data) {
    const sequence = data.pathway?.sequence?.number ?? 9;
    const knowledges = data.abilities?.knowledges;

    if (!knowledges) return;

    for (const name of ["Cosmology", "Mysticism", "Occult"]) {
        const ability = knowledges[name];
        if (!ability) continue;

        const limit = sequence > 5 ? 3 : ability.max;

        if (ability.value > limit) {
            throw new Error(
                `${name} cannot exceed ${limit} at Sequence ${sequence}`
            );
        }
    }
    }

    prepareDerivedData() {
        for (const categoryName of ["physical", "social", "mental"]) {
            const category = this.attributes?.[categoryName];
            if (!category) continue;

            for (const [attributeName, attribute] of Object.entries(category)) {
                if (attributeName === "importance" || !attribute) continue;

                const advancement = attribute.advancements;
                const normalLevels = advancement?.active
                    ? Number(advancement.levelsGained ?? 0)
                    : 0;
                const pathwayLevels = Number(advancement?.pathwayLevels ?? 0);

                let cap = Math.min(
                    10,
                    Number(attribute.baseCap ?? 0) + normalLevels + pathwayLevels
                );

                const pathwayCeiling = advancement?.pathwayCeiling;
                if (pathwayCeiling !== null && pathwayCeiling !== undefined) {
                    cap = Math.min(cap, Number(pathwayCeiling));
                }

                attribute.cap = cap;
            }
        }
    }
}