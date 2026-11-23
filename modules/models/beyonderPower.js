const fields = foundry.data.fields;

/** Ability keys use the same category and property names as AbilitiesDM. */
export const BEYONDER_POWER_ABILITY_OPTIONS = [
    {value:"talents.Initiative", fieldKey:"talents_Initiative", label:"Initiative"},
    {value:"talents.Athletics", fieldKey:"talents_Athletics", label:"Athletics"},
    {value:"talents.Brawl", fieldKey:"talents_Brawl", label:"Brawl"},
    {value:"talents.Dodge", fieldKey:"talents_Dodge", label:"Dodge"},
    {value:"talents.Empathy", fieldKey:"talents_Empathy", label:"Empathy"},
    {value:"talents.Expression", fieldKey:"talents_Expression", label:"Expression"},
    {value:"talents.Intimidation", fieldKey:"talents_Intimidation", label:"Intimidation"},
    {value:"talents.Leadership", fieldKey:"talents_Leadership", label:"Leadership"},
    {value:"talents.SleightofHand", fieldKey:"talents_SleightofHand", label:"Sleight of Hand"},
    {value:"talents.Subterfuge", fieldKey:"talents_Subterfuge", label:"Subterfuge"},

    {value:"skills.Crafts", fieldKey:"skills_Crafts", label:"Crafts"},
    {value:"skills.Drive", fieldKey:"skills_Drive", label:"Drive"},
    {value:"skills.Etiquette", fieldKey:"skills_Etiquette", label:"Etiquette"},
    {value:"skills.Firearms", fieldKey:"skills_Firearms", label:"Firearms"},
    {value:"skills.Meditation", fieldKey:"skills_Meditation", label:"Meditation"},
    {value:"skills.Melee", fieldKey:"skills_Melee", label:"Melee"},
    {value:"skills.Performance", fieldKey:"skills_Performance", label:"Performance"},
    {value:"skills.Stealth", fieldKey:"skills_Stealth", label:"Stealth"},
    {value:"skills.Survival", fieldKey:"skills_Survival", label:"Survival"},
    {value:"skills.Machinery", fieldKey:"skills_Machinery", label:"Machinery"},

    {value:"knowledges.Academics", fieldKey:"knowledges_Academics", label:"Academics"},
    {value:"knowledges.engineering", fieldKey:"knowledges_engineering", label:"Engineering"},
    {value:"knowledges.Cosmology", fieldKey:"knowledges_Cosmology", label:"Cosmology"},
    {value:"knowledges.Enigmas", fieldKey:"knowledges_Enigmas", label:"Enigmas"},
    {value:"knowledges.Investigation", fieldKey:"knowledges_Investigation", label:"Investigation"},
    {value:"knowledges.Law", fieldKey:"knowledges_Law", label:"Law"},
    {value:"knowledges.linguistics", fieldKey:"knowledges_linguistics", label:"Linguistics"},
    {value:"knowledges.Medicine", fieldKey:"knowledges_Medicine", label:"Medicine"},
    {value:"knowledges.Mysticism", fieldKey:"knowledges_Mysticism", label:"Mysticism"},
    {value:"knowledges.Occult", fieldKey:"knowledges_Occult", label:"Occult"}
];

/** Attribute keys use the same property names as AttributesDM. */
export const BEYONDER_POWER_ATTRIBUTE_OPTIONS = [
    {value:"strength", fieldKey:"physical_strength", category:"physical", label:"Strength"},
    {value:"dexterity", fieldKey:"physical_dexterity", category:"physical", label:"Dexterity"},
    {value:"stamina", fieldKey:"physical_stamina", category:"physical", label:"Stamina"},
    {value:"presence", fieldKey:"social_presence", category:"social", label:"Presence"},
    {value:"manipulation", fieldKey:"social_manipulation", category:"social", label:"Manipulation"},
    {value:"appearance", fieldKey:"social_appearance", category:"social", label:"Appearance"},
    {value:"perception", fieldKey:"mental_perception", category:"mental", label:"Perception"},
    {value:"intelligence", fieldKey:"mental_intelligence", category:"mental", label:"Intelligence"},
    {value:"wisdom", fieldKey:"mental_wisdom", category:"mental", label:"Wisdom"}
];

const ABILITY_CHOICES = Object.fromEntries(
    BEYONDER_POWER_ABILITY_OPTIONS.map(option => [option.value, option.label])
);

function createModifierField() {
    return new fields.SchemaField({
        enabled:new fields.BooleanField({required:true, initial:false}),
        modifier:new fields.NumberField({required:true, nullable:false, integer:true, min:-100, max:100, initial:0})
    });
}

function createModifierSchema(options) {
    return Object.fromEntries(options.map(option => [option.fieldKey, createModifierField()]));
}

export function createDefaultAbilityModifiers() {
    return Object.fromEntries(
        BEYONDER_POWER_ABILITY_OPTIONS.map(option => [option.fieldKey, {enabled:false, modifier:0}])
    );
}

export function createDefaultAttributeModifiers() {
    return Object.fromEntries(
        BEYONDER_POWER_ATTRIBUTE_OPTIONS.map(option => [option.fieldKey, {enabled:false, modifier:0}])
    );
}

/**
 * Returns the most advanced unlocked complete configuration.
 * An upgrade activates when the character reaches its configured Sequence.
 */
export function getEffectiveBeyonderPowerVersion(system, currentSequence) {
    const originSequence = Number(system?.sequence);
    const current = Number(currentSequence);

    if (!Number.isInteger(originSequence)) {
        return {
            sequence:system?.sequence ?? null,
            abilityModifiers:system?.abilityModifiers ?? {},
            abilityConfigured:system?.abilityModifiersConfigured === true,
            attributeModifiers:system?.attributeModifiers ?? {},
            attributeConfigured:system?.attributeModifiersConfigured === true,
            isUpgrade:false
        };
    }

    if (
        currentSequence === null || currentSequence === undefined || currentSequence === "" ||
        !Number.isInteger(current) || current < 0 || current > 9
    ) {
        return {
            sequence:originSequence,
            abilityModifiers:system?.abilityModifiers ?? {},
            abilityConfigured:system?.abilityModifiersConfigured === true,
            attributeModifiers:system?.attributeModifiers ?? {},
            attributeConfigured:system?.attributeModifiersConfigured === true,
            isUpgrade:false
        };
    }

    const eligibleUpgrades = (system?.upgrades ?? [])
        .filter(upgrade => {
            const sequence = Number(upgrade.sequence);
            return Number.isInteger(sequence) && sequence >= 0 && sequence < originSequence && sequence >= current;
        })
        .sort((a, b) => Number(a.sequence) - Number(b.sequence));

    const selected = eligibleUpgrades[0];
    if (selected) {
        return {
            sequence:Number(selected.sequence),
            abilityModifiers:selected.abilityModifiers ?? {},
            abilityConfigured:selected.abilityModifiersConfigured === true,
            attributeModifiers:selected.attributeModifiers ?? {},
            attributeConfigured:selected.attributeModifiersConfigured === true,
            isUpgrade:true
        };
    }

    return {
        sequence:originSequence,
        abilityModifiers:system?.abilityModifiers ?? {},
        abilityConfigured:system?.abilityModifiersConfigured === true,
        attributeModifiers:system?.attributeModifiers ?? {},
        attributeConfigured:system?.attributeModifiersConfigured === true,
        isUpgrade:false
    };
}

/** Returns enabled Ability modifiers for the active version. */
export function getBeyonderPowerAbilityModifiers(system, currentSequence) {
    const version = getEffectiveBeyonderPowerVersion(system, currentSequence);

    if (!version.abilityConfigured && !version.isUpgrade) {
        const legacyModifier = Math.trunc(Number(system?.rollModifier) || 0);
        const legacyAbilities = new Set(system?.relevantAbilities ?? []);
        return BEYONDER_POWER_ABILITY_OPTIONS
            .filter(option => legacyAbilities.has(option.value) && legacyModifier !== 0)
            .map(option => ({key:option.value, fieldKey:option.fieldKey, label:option.label, modifier:legacyModifier}));
    }

    return BEYONDER_POWER_ABILITY_OPTIONS
        .filter(option => version.abilityModifiers?.[option.fieldKey]?.enabled === true)
        .map(option => ({
            key:option.value,
            fieldKey:option.fieldKey,
            label:option.label,
            modifier:Math.trunc(Number(version.abilityModifiers?.[option.fieldKey]?.modifier) || 0)
        }));
}

/** Returns enabled Attribute modifiers for the active version. */
export function getBeyonderPowerAttributeModifiers(system, currentSequence) {
    const version = getEffectiveBeyonderPowerVersion(system, currentSequence);
    if (!version.attributeConfigured) return [];

    return BEYONDER_POWER_ATTRIBUTE_OPTIONS
        .filter(option => version.attributeModifiers?.[option.fieldKey]?.enabled === true)
        .map(option => ({
            key:option.value,
            fieldKey:option.fieldKey,
            category:option.category,
            label:option.label,
            modifier:Math.trunc(Number(version.attributeModifiers?.[option.fieldKey]?.modifier) || 0)
        }));
}

export class BeyonderPowerData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            pathwayName:new fields.StringField({required:true, blank:true, initial:""}),
            sequence:new fields.NumberField({required:true, nullable:false, integer:true, min:0, max:9, initial:9}),
            description:new fields.StringField({initial:""}),

            abilityModifiers:new fields.SchemaField(createModifierSchema(BEYONDER_POWER_ABILITY_OPTIONS)),
            abilityModifiersConfigured:new fields.BooleanField({required:true, initial:false}),
            attributeModifiers:new fields.SchemaField(createModifierSchema(BEYONDER_POWER_ATTRIBUTE_OPTIONS)),
            attributeModifiersConfigured:new fields.BooleanField({required:true, initial:false}),

            upgrades:new fields.ArrayField(
                new fields.SchemaField({
                    sequence:new fields.NumberField({required:true, nullable:false, integer:true, min:0, max:8, initial:8}),
                    abilityModifiers:new fields.SchemaField(createModifierSchema(BEYONDER_POWER_ABILITY_OPTIONS)),
                    abilityModifiersConfigured:new fields.BooleanField({required:true, initial:true}),
                    attributeModifiers:new fields.SchemaField(createModifierSchema(BEYONDER_POWER_ATTRIBUTE_OPTIONS)),
                    attributeModifiersConfigured:new fields.BooleanField({required:true, initial:true})
                }),
                {initial:() => []}
            ),

            // Retained for legacy Items created with the earlier shared-modifier format.
            relevantAbilities:new fields.ArrayField(
                new fields.StringField({choices:ABILITY_CHOICES}),
                {initial:() => []}
            ),
            rollModifier:new fields.NumberField({required:true, nullable:false, integer:true, min:-100, max:100, initial:0}),
            effectRolls:new fields.StringField({initial:""})
        };
    }
}
