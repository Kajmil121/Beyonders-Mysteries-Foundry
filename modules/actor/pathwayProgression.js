import {BEYONDER_POWER_ABILITY_OPTIONS,BEYONDER_POWER_ATTRIBUTE_OPTIONS,createDefaultAbilityModifiers,createDefaultAttributeModifiers} from "../models/beyonderPower.js";
import {grantEligibleBeyonderPowers} from "./beyonderPowerProgression.js";
const {HandlebarsApplicationMixin} = foundry.applications.api;
const {ItemSheetV2} = foundry.applications.sheets;

const ABILITY_GROUPS = [
    {key:"talents", label:"Talents"},
    {key:"skills", label:"Skills"},
    {key:"knowledges", label:"Knowledges"}
];

const ATTRIBUTE_GROUPS = [
    {key:"physical", label:"Physical"},
    {key:"social", label:"Social"},
    {key:"mental", label:"Mental"}
];

function cloneData(value) {
    return foundry.utils.deepClone(value ?? {});
}

function collectionContents(collection) {
    if (!collection) return [];
    if (Array.isArray(collection.contents)) return collection.contents;
    return Array.from(collection.values?.() ?? collection);
}

function normalizeName(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
}

/** Find the Pathway Item an Actor was assigned, including older assignments without a saved UUID. */
export async function getPathwayItemForActor(actor) {
    if (!actor) return null;

    const sourceUuid = actor.getFlag?.("Beyond", "pathwaySourceUuid");
    if (sourceUuid) {
        try {
            const source = await fromUuid(sourceUuid);
            if (source?.type === "Pathway") return source;
        } catch (error) {
            console.warn(`Beyond | Could not load assigned Pathway ${sourceUuid}`, error);
        }
    }

    const pathway = actor.system?.pathway?.pathway ?? {};
    const wantedName = normalizeName(pathway.name);
    if (!wantedName) return null;

    const wantedProfile = normalizeName(pathway.profile);
    const candidates = collectionContents(game.items).filter(item =>
        item.type === "Pathway" && normalizeName(item.name) === wantedName
    );

    for (const pack of collectionContents(game.packs)) {
        if (pack.documentName !== "Item") continue;
        try {
            const documents = await pack.getDocuments({type:"Pathway"});
            for (const item of documents) {
                if (item.type === "Pathway" && normalizeName(item.name) === wantedName) {
                    candidates.push(item);
                }
            }
        } catch (error) {
            console.warn(`Beyond | Could not read Pathways from ${pack.collection}`, error);
        }
    }

    const uniqueCandidates = [...new Map(candidates.map(item => [item.uuid, item])).values()];
    const matchingProfile = uniqueCandidates.find(item =>
        normalizeName(item.system.profile) === wantedProfile
    );
    const source = matchingProfile ?? uniqueCandidates[0] ?? null;
    if (source && sourceUuid !== source.uuid) {
        await actor.setFlag?.("Beyond", "pathwaySourceUuid", source.uuid);
    }
    return source;
}

/** Assign a Pathway Item to a Beyonder actor. */
export async function assignPathwayToActor(actor, pathwayItem) {
    if (!actor || pathwayItem?.type !== "Pathway") return null;

    const sequences = Array.from(pathwayItem.system.sequences ?? []);
    if (!sequences.length) return null;

    const currentSequenceValue = actor.system.pathway?.sequence?.number;
    const currentSequence = Number(currentSequenceValue);
    const hasCurrentSequence = currentSequenceValue !== null && currentSequenceValue !== undefined && currentSequenceValue !== "";
    const targetSequence = hasCurrentSequence && Number.isInteger(currentSequence) && sequences.some(sequence => Number(sequence.number) === currentSequence)
        ? currentSequence
        : 9;
    const sequenceData = sequences.find(sequence => Number(sequence.number) === targetSequence)
        ?? [...sequences].sort((a, b) => Number(b.number) - Number(a.number))[0];
    if (!sequenceData) return null;

    await actor.update({
        "system.pathway.pathway.name":pathwayItem.name,
        "system.pathway.pathway.profile":pathwayItem.system.profile,
        "system.pathway.sequence.number":Number(sequenceData.number),
        "system.pathway.sequence.name":sequenceData.name ?? ""
    });
    await actor.setFlag("Beyond", "pathwaySourceUuid", pathwayItem.uuid);

    return pathwayItem;
}

function buildAbilityGroups(settings, configured, legacyAbilities = [], legacyModifier = 0) {
    const legacySet = new Set(legacyAbilities ?? []);

    return ABILITY_GROUPS.map(group => ({
        key:group.key,
        label:group.label,
        options:BEYONDER_POWER_ABILITY_OPTIONS
            .filter(option => option.value.startsWith(`${group.key}.`))
            .map(option => {
                const setting = settings?.[option.fieldKey];
                const selected = configured
                    ? setting?.enabled === true
                    : legacySet.has(option.value);

                return {
                    ...option,
                    selected,
                    modifier:configured
                        ? Number(setting?.modifier) || 0
                        : (selected ? Number(legacyModifier) || 0 : 0)
                };
            })
    }));
}

function migrateBaseSettings(system) {
    const settings = createDefaultAbilityModifiers();

    for (const option of BEYONDER_POWER_ABILITY_OPTIONS) {
        const existing = system.abilityModifiers?.[option.fieldKey];
        settings[option.fieldKey] = {
            enabled:existing?.enabled === true,
            modifier:Number(existing?.modifier) || 0
        };
    }

    if (system.abilityModifiersConfigured !== true) {
        const legacyAbilities = new Set(system.relevantAbilities ?? []);
        for (const option of BEYONDER_POWER_ABILITY_OPTIONS) {
            if (!legacyAbilities.has(option.value)) continue;
            settings[option.fieldKey] = {
                enabled:true,
                modifier:Number(system.rollModifier) || 0
            };
        }
    }

    return settings;
}

function migrateBaseAttributeSettings(system) {
    const settings = createDefaultAttributeModifiers();

    for (const option of BEYONDER_POWER_ATTRIBUTE_OPTIONS) {
        const existing = system.attributeModifiers?.[option.fieldKey];
        settings[option.fieldKey] = {
            enabled:existing?.enabled === true,
            modifier:Number(existing?.modifier) || 0
        };
    }

    return settings;
}

function buildAttributeGroups(settings, configured) {
    return ATTRIBUTE_GROUPS.map(group => ({
        key:group.key,
        label:group.label,
        options:BEYONDER_POWER_ATTRIBUTE_OPTIONS
            .filter(option => option.category === group.key)
            .map(option => {
                const setting = settings?.[option.fieldKey];
                return {
                    ...option,
                    selected:configured && setting?.enabled === true,
                    modifier:configured ? Number(setting?.modifier) || 0 : 0
                };
            })
    }));
}

function makeVersionContext(upgrade, index, originSequence, allUpgrades) {
    const usedSequences = new Set([
        Number(originSequence),
        ...allUpgrades.filter((entry, entryIndex) => entryIndex !== index).map(entry => Number(entry.sequence))
    ]);

    const sequenceOptions = Array.from({length:Number(originSequence)}, (_, offset) => Number(originSequence) - 1 - offset)
        .filter(sequence => sequence >= 0 && (!usedSequences.has(sequence) || sequence === Number(upgrade.sequence)))
        .map(value => ({value, selected:Number(upgrade.sequence) === value}));

    return {
        index,
        sequence:Number(upgrade.sequence),
        sequenceOptions,
        abilityGroups:buildAbilityGroups(upgrade.abilityModifiers, upgrade.abilityModifiersConfigured === true)
            .map(group => ({
                ...group,
                options:group.options.map(option => ({...option, versionKey:String(index)}))
            })),
        attributeGroups:buildAttributeGroups(upgrade.attributeModifiers, upgrade.attributeModifiersConfigured === true)
            .map(group => ({
                ...group,
                options:group.options.map(option => ({...option, versionKey:String(index)}))
            }))
    };
}

export class BeyonderPowerSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        ...super.DEFAULT_OPTIONS,
        classes:["beyond", "beyonder-power-sheet"],
        position:{width:820, height:900},
        editPermission:CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        window:{
            ...super.DEFAULT_OPTIONS.window,
            title:"",
            resizable:true,
            minimizable:true
        },
        form:{
            ...super.DEFAULT_OPTIONS.form,
            submitOnChange:false,
            closeOnSubmit:false
        }
    };

    static PARTS = {
        form:{template:"systems/Beyond/templates/item/beyonder-power-sheet.hbs"}
    };

    get title() {
        return this.item.name;
    }

    _saveScrollPosition() {
        const editor = this.element.querySelector(".beyonder-power-editor");
        this._savedScrollPosition = editor?.scrollTop ?? 0;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.item.system;
        const rawUpgrades = (system.upgrades ?? []).map((upgrade, index) => ({
            upgrade:cloneData(upgrade),
            originalIndex:index
        }));
        const upgrades = [...rawUpgrades].sort(
            (a, b) => Number(b.upgrade.sequence) - Number(a.upgrade.sequence)
        );

        context.item = this.item;
        context.system = system;
        context.editable = this.isEditable;
        context.sequenceOptions = Array.from({length:10}, (_, index) => ({
            value:9 - index,
            selected:Number(system.sequence) === 9 - index
        }));
        context.baseAbilityGroups = buildAbilityGroups(
            system.abilityModifiers,
            system.abilityModifiersConfigured === true,
            system.relevantAbilities,
            system.rollModifier
        ).map(group => ({
            ...group,
            options:group.options.map(option => ({...option, versionKey:"base"}))
        }));
        context.baseAttributeGroups = buildAttributeGroups(
            system.attributeModifiers,
            system.attributeModifiersConfigured === true
        ).map(group => ({
            ...group,
            options:group.options.map(option => ({...option, versionKey:"base"}))
        }));
        context.upgrades = upgrades.map(entry =>
            makeVersionContext(entry.upgrade, entry.originalIndex, system.sequence, system.upgrades ?? [])
        );

        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        // Restore scroll position after rerender.
        if (this._savedScrollPosition !== undefined) {
            const editor = this.element.querySelector(".beyonder-power-editor");
            if (editor) editor.scrollTop = this._savedScrollPosition;
            this._savedScrollPosition = undefined;
        }

        this.element.querySelectorAll("[data-power-field]").forEach(field => {
            field.addEventListener("change", event => this._onFieldChange(event));
        });

        this.element.querySelector("[data-add-power-upgrade]")?.addEventListener("click", event => {
            event.preventDefault();
            void this._onAddUpgrade();
        });

        this.element.querySelectorAll("[data-remove-power-upgrade]").forEach(button => {
            button.addEventListener("click", event => {
                event.preventDefault();
                void this._onRemoveUpgrade(Number(event.currentTarget.dataset.removePowerUpgrade));
            });
        });

        this.form?.addEventListener("submit", event => event.preventDefault());
    }

    async _onFieldChange(event) {
        if (!this.isEditable) return;

        this._saveScrollPosition();

        const field = event.currentTarget;
        const property = field.dataset.powerField;
        const version = field.dataset.powerVersion ?? "base";
        const settingKey = field.dataset.powerAbility;

        try {
            if (property === "abilityEnabled" || property === "abilityModifier" ||
                property === "attributeEnabled" || property === "attributeModifier") {
                await this._updatePowerSetting({
                    version,
                    settingKey,
                    property,
                    value:property.endsWith("Enabled") ? field.checked : Number(field.value)
                });
                return;
            }

            if (property === "upgradeSequence") {
                const upgrades = cloneData(this.item.system.upgrades);
                const index = Number(field.dataset.upgradeIndex);
                const sequence = Number(field.value);
                const baseSequence = Number(this.item.system.sequence);

                if (!Number.isInteger(index) || !upgrades[index] || !Number.isInteger(sequence) || sequence < 0 || sequence >= baseSequence) return;
                if (upgrades.some((upgrade, upgradeIndex) => upgradeIndex !== index && Number(upgrade.sequence) === sequence)) {
                    ui.notifications.warn("Another upgrade already uses that Sequence.");
                    field.value = String(this.item.system.upgrades[index].sequence);
                    return;
                }

                upgrades[index].sequence = sequence;
                await this.item.update({"system.upgrades":upgrades});
                return;
            }

            let value = field.value;
            if (property === "sequence") {
                value = Number(value);
                if (!Number.isInteger(value) || value < 0 || value > 9) return;
                const hasInvalidUpgrade = (this.item.system.upgrades ?? []).some(upgrade => Number(upgrade.sequence) >= value);
                if (hasInvalidUpgrade) {
                    ui.notifications.warn("The original Sequence must be higher than every upgrade Sequence.");
                    field.value = String(this.item.system.sequence);
                    return;
                }
            }

            if (property === "name") {
                await this.item.update({name:value});
                return;
            }

            await this.item.update({[`system.${property}`]:value});
        } catch (error) {
            console.error("Beyond | Could not update Beyonder Power", error);
            ui.notifications.error("Could not save Beyonder Power changes.");
        }
    }

    async _updatePowerSetting({version, settingKey, property, value}) {
        const isAttribute = property.startsWith("attribute");
        const options = isAttribute ? BEYONDER_POWER_ATTRIBUTE_OPTIONS : BEYONDER_POWER_ABILITY_OPTIONS;
        if (!settingKey || !options.some(option => option.fieldKey === settingKey)) return;

        if (property.endsWith("Modifier") && (!Number.isInteger(value) || value < -100 || value > 100)) {
            ui.notifications.warn("Power modifiers must be whole numbers between -100 and 100.");
            return;
        }

        const settingsKey = isAttribute ? "attributeModifiers" : "abilityModifiers";
        const configuredKey = isAttribute ? "attributeModifiersConfigured" : "abilityModifiersConfigured";
        const createDefaults = isAttribute ? createDefaultAttributeModifiers : createDefaultAbilityModifiers;

        if (version === "base") {
            const settings = isAttribute
                ? migrateBaseAttributeSettings(this.item.system)
                : migrateBaseSettings(this.item.system);
            settings[settingKey] ??= {enabled:false, modifier:0};
            if (property.endsWith("Enabled")) settings[settingKey].enabled = value;
            else settings[settingKey].modifier = value;

            await this.item.update({
                [`system.${settingsKey}`]:settings,
                [`system.${configuredKey}`]:true
            });
            return;
        }

        const upgrades = cloneData(this.item.system.upgrades);
        const index = Number(version);
        const upgrade = upgrades[index];
        if (!upgrade) return;

        upgrade[settingsKey] ??= createDefaults();
        upgrade[settingsKey][settingKey] ??= {enabled:false, modifier:0};
        if (property.endsWith("Enabled")) upgrade[settingsKey][settingKey].enabled = value;
        else upgrade[settingsKey][settingKey].modifier = value;
        upgrade[configuredKey] = true;

        await this.item.update({"system.upgrades":upgrades});
    }

    async _onAddUpgrade() {
        if (!this.isEditable) return;

        const system = this.item.system;
        const baseSequence = Number(system.sequence);
        const upgrades = cloneData(system.upgrades);
        const usedSequences = new Set([baseSequence, ...upgrades.map(upgrade => Number(upgrade.sequence))]);
        let sequence = null;

        for (let candidate = baseSequence - 1; candidate >= 0; candidate--) {
            if (!usedSequences.has(candidate)) {
                sequence = candidate;
                break;
            }
        }

        if (sequence === null) {
            ui.notifications.info("There are no higher Sequences left to add.");
            return;
        }

        const previousUpgrade = upgrades
            .filter(upgrade => Number(upgrade.sequence) > sequence)
            .sort((a, b) => Number(a.sequence) - Number(b.sequence))[0];

        const inheritedAbilitySettings = previousUpgrade
            ? cloneData(previousUpgrade.abilityModifiers)
            : migrateBaseSettings(system);
        const inheritedAttributeSettings = previousUpgrade
            ? cloneData(previousUpgrade.attributeModifiers ?? createDefaultAttributeModifiers())
            : migrateBaseAttributeSettings(system);

        upgrades.push({
            sequence,
            abilityModifiers:inheritedAbilitySettings,
            abilityModifiersConfigured:true,
            attributeModifiers:inheritedAttributeSettings,
            attributeModifiersConfigured:true
        });

        upgrades.sort((a, b) => Number(b.sequence) - Number(a.sequence));

        this._saveScrollPosition();
        await this.item.update({"system.upgrades":upgrades});
    }

    async _onRemoveUpgrade(index) {
        if (!this.isEditable) return;

        const upgrades = cloneData(this.item.system.upgrades);
        if (!Number.isInteger(index) || !upgrades[index]) return;

        upgrades.splice(index, 1);

        this._saveScrollPosition();
        await this.item.update({"system.upgrades":upgrades});
    }
}
