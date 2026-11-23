
import {rollD10Pool} from "../rolls/roll.js";
import {assignPathwayToActor, getPathwayItemForActor} from "./pathwayProgression.js";
import {grantEligibleBeyonderPowers} from "./beyonderPowerProgression.js";
import {
    getAvailableDeterminationMaximum,
    getEffectiveDeterminationMax,
    getStabilityValue
} from "./progressionRules.js";
import {getSequenceTier} from "../models/pathwayItem.js";
import {getPathwayProfileScaling} from "../models/pathwayProfiles.js";
import {
    getBeyonderPowerAbilityModifiers,
    getBeyonderPowerAttributeModifiers,
    getEffectiveBeyonderPowerVersion
} from "../models/beyonderPower.js";

const {HandlebarsApplicationMixin} = foundry.applications.api;
const {ActorSheetV2} = foundry.applications.sheets;

const ABILITY_ATTRIBUTE_OPTIONS = [
    {key: "strength", label: "Strength", category: "physical"},
    {key: "dexterity", label: "Dexterity", category: "physical"},
    {key: "stamina", label: "Stamina", category: "physical"},
    {key: "presence", label: "Presence", category: "social"},
    {key: "manipulation", label: "Manipulation", category: "social"},
    {key: "appearance", label: "Appearance", category: "social"},
    {key: "perception", label: "Perception", category: "mental"},
    {key: "intelligence", label: "Intelligence", category: "mental"},
    {key: "wisdom", label: "Wisdom", category: "mental"}
];


function getEffectivePowerSequence(powerSystem, currentSequence) {
    return getEffectiveBeyonderPowerVersion(powerSystem, currentSequence).sequence;
}

function getDigestionImagePath(value) {
    const digestion = Math.min(100, Math.max(0, Math.trunc(Number(value) || 0)));
    const image = digestion < 10 ? "Empty" : String(Math.ceil(digestion / 10) * 10);
    return `systems/Beyond/assets/digestion/${image}.svg`;
}

function getPathwayTierValue(sequence) {
    if (sequence === 0) return "Above";
    if (sequence >= 1 && sequence <= 4) return "High";
    if (sequence >= 5 && sequence <= 7) return "Mid";
    return "Low";
}

function getStabilityOutcomeLabel(entry) {
    const labels = {
        stability:amount => `Stability +${amount}`,
        derangement:amount => amount > 0 ? `Derangement x${amount} (add manually)` : "Derangement (add item manually)",
        determinationMax:amount => `Maximum Determination −${amount}`,
        determinationTemp:amount => `Temporary Determination −${amount}`
    };

    const outcomes = Array.isArray(entry.outcomes)
        ? entry.outcomes
        : entry.outcome && !["none", "pending", "multiple"].includes(String(entry.outcome))
            ? [{type:entry.outcome, amount:entry.outcomeAmount}]
            : [];

    if (outcomes.length) {
        return outcomes.map(outcome => labels[outcome.type]?.(Number(outcome.amount) || 0)).filter(Boolean).join("; ");
    }
    if (entry.outcome === "pending") return "Consequence not selected";
    return "";
}

export class BeyonderSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        ...super.DEFAULT_OPTIONS,
        classes: ["beyond", "beyonder"],
        position: {width: 950, height: 900},
        window: {
            ...super.DEFAULT_OPTIONS.window,
            title: "",
            resizable: true,
            minimizable: true
        },
        form: {
            ...super.DEFAULT_OPTIONS.form,
            submitOnChange: true,
            closeOnSubmit: false
        }
    };

    get title() {
        return this.actor.name;
    }

    static PARTS = {
        form: {
            template: "systems/Beyond/templates/actor/beyonder-sheet.hbs"
        }
    };

    _saveScrollPosition() {
        const page = this.element.querySelector(".sheet-page:not([hidden])");
        if (!page?.dataset.page) return;
        this._savedScrollPositions ??= {};
        this._savedScrollPositions[page.dataset.page] = page.scrollTop;
    }


    /* ============================================
       1. PREPARE SHEET CONTEXT
    ============================================ */

    async _prepareContext(options) {
        console.log("Beyond | Preparing BeyonderSheet context");

        const context = await super._prepareContext(options);

        context.actor = this.actor;
        context.system = this.actor.system;
        context.editable = this.isEditable;
        context.tierLabel = getSequenceTier(
            context.system.pathway?.sequence?.number
        ) ?? "Mundane";

        const pathwaySystem = context.system.pathway ?? {};
        const currentSequenceNumber = Number(pathwaySystem.sequence?.number);
        const pathwayProfileLabels = {
            mystic:"Mystic",
            mixed:"Mixed",
            corporeal:"Corporeal"
        };
        context.pathwayPage = {
            name:pathwaySystem.pathway?.name || "No Pathway assigned",
            sequenceNumber:pathwaySystem.sequence?.number,
            sequenceName:pathwaySystem.sequence?.name,
            hasSequence:pathwaySystem.sequence?.number !== null && pathwaySystem.sequence?.number !== undefined,
            profile:pathwayProfileLabels[pathwaySystem.pathway?.profile] ?? pathwaySystem.pathway?.profile ?? "Not set",
            authorities:pathwaySystem.pathway?.authority,
            icon:this.actor.getFlag("Beyond", "pathwayIcon"),
            actingMethod:pathwaySystem.actingMethod ?? "",
            anchors:pathwaySystem.anchors ?? ""
        };
        const progressionDetermination = context.system.determination ?? {};
        const digestionValue = Math.min(100, Math.max(0, Math.trunc(Number(pathwaySystem.sequence?.digestion) || 0)));
        const digestionOverflow = Math.min(19, Math.max(0, Math.trunc(Number(pathwaySystem.sequence?.digestionOverflow) || 0)));
        const stabilityValue = getStabilityValue(this.actor);
        const transgressionRaw = progressionDetermination.transgressions?.value;
        const transgressionValue = transgressionRaw === null || transgressionRaw === undefined
            ? null
            : Number(transgressionRaw);
        const stabilityStages = ["Lucid", "Tense", "Shaken", "Fragmented", "Fragmented", "Dissociated", "Dissociated", "Collapse"];
        const transgressionStage = transgressionValue === null ? "None" :
            transgressionValue === 0 ? "Clear" :
            transgressionValue <= 2 ? "Residue" :
            transgressionValue <= 4 ? "Dissonance" :
            transgressionValue <= 6 ? "Resonance" :
            transgressionValue <= 8 ? "Creator's Voice" :
            transgressionValue === 9 ? "Imminent Rupture" : "Rupture";
        const stabilityEffects = [
            "No Stability penalties.",
            "Effective Determination -1; Stability roll difficulty +1.",
            "Effective Determination -2; Perception and Wisdom rolls -1 die.",
            "Effective Determination -3; mental and social rolls -2 dice.",
            "Effective Determination -4; mental and social rolls -2 dice.",
            "Effective Determination -5; mental and social rolls -3 dice; Sequence rolls -1 die.",
            "Effective Determination -6; mental and social rolls -3 dice; Sequence rolls -1 die.",
            "Collapse: Temporary Determination unavailable, advances Loss of Control."
        ];
        let transgressionEffects = transgressionValue === null
            ? "No transgressions recorded."
            : transgressionValue === 0
                ? "Rupture cleared the Transgression track."
                : transgressionValue <= 2
                    ? "The next Stability roll difficulty increases by 1."
                    : transgressionValue <= 4
                        ? "Sequence roll difficulty +1; Loss of Control difficulty +1."
                        : transgressionValue <= 6
                            ? "Narrative consequences decided by the Narrator."
                            : transgressionValue <= 8
                                ? "Creator's Voice; narrative consequences."
                                : transgressionValue === 9
                                    ? "Imminent Rupture; narrative consequences."
                                    : "Rupture: clears this track and advances Loss of Control.";
        const residuePending = progressionDetermination.transgressions?.residuePending === true;
        if (residuePending && (transgressionValue === null || transgressionValue > 2)) {
            transgressionEffects += " A Residue penalty is pending on the next Stability roll.";
        }
        const controlValue = Math.min(4, Math.max(0, Math.trunc(Number(progressionDetermination.control?.value) || 0)));
        context.progressionPage = {
            digestion:digestionValue,
            digestionImage:getDigestionImagePath(digestionValue),
            digestionOverflow,
            canIncreaseDigestion:digestionValue < 100,
            canDecreaseDigestion:digestionValue > 0,
            canAdvance:digestionValue >= 60 &&
                Boolean(pathwaySystem.pathway?.name) &&
                Number.isInteger(currentSequenceNumber) &&
                currentSequenceNumber > 0,
            transgressions:transgressionValue,
            hasTransgressions:transgressionValue !== null,
            canIncreaseTransgressions:transgressionValue === null || transgressionValue < 10,
            canDecreaseTransgressions:transgressionValue !== null && transgressionValue > 0,
            transgressionBoxes:Array.from({length:10}, (_, index) => ({
                active:transgressionValue !== null && transgressionValue >= index + 1
            })),
            transgressionStage,
            transgressionEffects,
            stability:stabilityValue,
            stabilityStage:stabilityStages[stabilityValue],
            stabilityEffects:stabilityEffects[stabilityValue],
            stabilityBoxes:Array.from({length:7}, (_, index) => ({active:stabilityValue >= index + 1})),
            isCollapse:stabilityValue === 7,
            canRollStability:getEffectiveDeterminationMax(this.actor) > 0,
            control:controlValue,
            controlAtFinalRung:controlValue >= 4,
            controlRungs:[
                {number:1, label:"Instability"},
                {number:2, label:"Destabilization"},
                {number:3, label:"Mental Pollution"},
                {number:4, label:"Absolute Loss of Control"}
            ].map(rung => ({
                ...rung,
                active:controlValue >= rung.number,
                current:controlValue === rung.number
            }))
        };
        const stabilityHistory = Array.from(progressionDetermination.stability?.history ?? []);
        const stabilityTriggerMap = new Map();
        for (const entry of stabilityHistory) {
            const triggerKey = String(entry.trigger ?? "").trim().toLocaleLowerCase();
            if (!triggerKey) continue;
            const previous = stabilityTriggerMap.get(triggerKey);
            stabilityTriggerMap.set(triggerKey, {
                trigger:String(entry.trigger).trim(),
                baseDifficulty:Number(entry.baseDifficulty) || 6,
                exposures:(previous?.exposures ?? 0) + 1
            });
        }
        context.stabilityTriggers = [...stabilityTriggerMap.values()]
            .sort((a, b) => a.trigger.localeCompare(b.trigger));
        context.stabilityHistory = [...stabilityHistory]
            .reverse()
            .map(entry => ({
                ...entry,
                outcomeLabel:getStabilityOutcomeLabel(entry),
                timestampLabel:entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ""
            }));
        context.stabilityHistoryCount = stabilityHistory.length;

        context.importanceOptions = ["Primary", "Secondary", "Tertiary"];
        context.importanceInitials = {Primary: "P", Secondary: "S", Tertiary: "T"};
        context.attributeDots = {};
        context.abilityGroups = {};

        const currentSequence = context.system.pathway?.sequence?.number;

        const favoritePowerIds = new Set(
            this.actor.getFlag("Beyond", "favoriteBeyonderPowers") ?? []
        );
        context.beyonderPowers = this.actor.items
            .filter(item => item.type === "BeyonderPower")
            .map(item => {
                const activeVersion = getEffectiveBeyonderPowerVersion(item.system, currentSequence);
                const relevantAbilities = getBeyonderPowerAbilityModifiers(item.system, currentSequence);
                const relevantAttributes = getBeyonderPowerAttributeModifiers(item.system, currentSequence);
                return {
                    id:item.id,
                    name:item.name,
                    sequence:Number(item.system.sequence),
                    pathwayName:item.system.pathwayName,
                    description:item.system.description,
                    activeVersionSequence:activeVersion.sequence,
                    isUpgraded:activeVersion.isUpgrade,
                    isFavorite:favoritePowerIds.has(item.id),
                    relevantAbilities:relevantAbilities.map(ability => ({
                        label:ability.label,
                        modifier:ability.modifier,
                        modifierLabel:`${ability.modifier > 0 ? "+" : ""}${ability.modifier}`
                    })),
                    relevantAttributes:relevantAttributes.map(attribute => ({
                        label:attribute.label,
                        modifier:attribute.modifier,
                        modifierLabel:`${attribute.modifier > 0 ? "+" : ""}${attribute.modifier}`
                    })),
                    effectRolls:item.system.effectRolls
                };
            })
            .sort((a, b) => b.sequence - a.sequence || a.name.localeCompare(b.name));

            const favoritePowers = context.beyonderPowers.filter(power => power.isFavorite);

            context.beyonderPowerSections = [
                ...(favoritePowers.length
                    ? [{label:"Favorite Powers", isFavorite:true, powers:favoritePowers}]
                    : []),

                ...Array.from({length:10}, (_, index) => 9 - index)
                    .map(sequence => ({
                        label:`Sequence ${sequence} Powers`,
                        powers:context.beyonderPowers.filter(
                            power => power.sequence === sequence && !power.isFavorite
                        )
                    }))
                    .filter(section => section.powers.length > 0)
            ];

        context.attributeLocked = context.system.attributes.locked;
        context.abilityLocked = context.system.abilities.locked;
        context.backgroundLocked = context.system.backgrounds.locked;

        /* ============================================
           INTEGRITY
        ============================================ */

        const integrity = context.system.health.integrity;
        const damage = context.system.health.damage;

        const bashing = Number(damage.bashing) || 0;
        const lethal = Number(damage.lethal) || 0;
        const aggravated = Number(damage.aggravated) || 0;

        context.integrityBoxes = Array.from({length: integrity.max}, (_, i) => {
            const type = i < aggravated ? "aggravated" :
                i < aggravated + lethal ? "lethal" :
                i < aggravated + lethal + bashing ? "bashing" : "empty";

            return {
                index: i,
                type,
                label: type.charAt(0).toUpperCase() + type.slice(1)
            };
        });

        const freeIntegrity = Math.max(
            0,
            integrity.max - bashing - lethal - aggravated
        );

        context.integrityConditions = {
            unharmed: freeIntegrity >= 5,
            bruised: freeIntegrity === 4,
            wounded: freeIntegrity === 3,
            badlyWounded: freeIntegrity === 2,
            crippled: freeIntegrity === 1,
            incapacitated: freeIntegrity === 0
        };

        context.conditionPenalty =
            freeIntegrity >= 5 ? 0 :
            freeIntegrity === 4 ? -1 :
            freeIntegrity === 3 ? -2 :
            freeIntegrity === 2 ? -3 :
            freeIntegrity === 1 ? -5 : -99;

        this._conditionPenalty = context.conditionPenalty;


        /* ============================================
           ATTRIBUTES
        ============================================ */

        for (const [category, attributes] of Object.entries(context.system.attributes)) {
            if (category === "locked") continue;

            context.attributeDots[category] = {
                importance: attributes.importance,
                categories: context.importanceOptions
            };

            for (const [name, attribute] of Object.entries(attributes)) {
                if (name === "importance" || name === "locked") continue;

                context.attributeDots[category][name] = {
                    name,
                    bonus: attribute.bonus + (category === "physical" ? context.conditionPenalty : 0),
                    max: attribute.max,
                    cap: attribute.cap,
                    dots: Array.from({length: 10}, (_, i) => ({
                        value: i + 1,
                        checked: attribute.value >= i + 1,
                        locked: i + 1 > attribute.cap,
                        creationCap: i + 1 === 5,
                        editable: context.editable && !context.attributeLocked
                    }))
                };
            }
        }


        /* ============================================
           ABILITIES
        ============================================ */

        const sequenceNumber = context.system.pathway?.sequence?.number ?? null;

        for (const [category, abilities] of Object.entries(context.system.abilities)) {
            if (category === "locked") continue;

            context.abilityGroups[category] = {
                importance: abilities.importance,
                categories: context.importanceOptions,
                abilities: Object.entries(abilities)
                    .filter(([name]) => name !== "importance" && name !== "locked")
                    .map(([name, ability]) => {
                        const dangerousLimit = ability.dangerous &&
                            (sequenceNumber === null || sequenceNumber >= 6)
                            ? 3
                            : ability.max;

                        return {
                            name,
                            label: name.charAt(0).toUpperCase() + name.slice(1),
                            bonus: ability.bonus,
                            dangerous: ability.dangerous,
                            dots: Array.from({length: 5}, (_, i) => ({
                                value: i + 1,
                                checked: ability.value >= i + 1,
                                locked: i + 1 > dangerousLimit,
                                editable: context.editable && !context.abilityLocked
                            }))
                        };
                    })
            };
        }


        /* ============================================
           BACKGROUNDS
        ============================================ */

        context.backgroundGroups = Object.entries(context.system.backgrounds)
            .filter(([name]) => name !== "locked")
            .map(([name, background]) => ({
                name,
                label: {
                    allies: "Allies",
                    contacts: "Contacts",
                    spirituality: "Spirituality",
                    inheritance: "Inheritance",
                    beyonderOrganization: "Beyonder Organization",
                    influence: "Influence",
                    mentor: "Mentor",
                    resources: "Resources"
                }[name] ?? name,
                valueDots: Array.from({length: 5}, (_, i) => ({
                    value: i + 1,
                    checked: background.value >= i + 1,
                    editable: context.editable && !context.backgroundLocked
                })),
                legendaryDots: Array.from({length: 5}, (_, i) => ({
                    value: i + 1,
                    checked: background.legendary >= i + 1,
                    editable: context.editable && !context.backgroundLocked
                }))
            }));


        /* ============================================
           SPIRITUALITY
        ============================================ */

        const spirituality = context.system.pathway?.spirituality;

        const spiritualityMax = Math.min(
            20,
            Math.max(0, Math.trunc(Number(spirituality?.max) || 0))
        );

        const spiritualityValue = Math.min(
            spiritualityMax,
            Math.max(0, Math.trunc(Number(spirituality?.value) || 0))
        );

        context.spirituality = {
            max: spiritualityMax,
            value: spiritualityValue,
            boxes: Array.from({length: spiritualityMax}, (_, i) => ({
                index: i,
                value: i + 1,
                checked: i < spiritualityValue,
                editable: context.editable
            }))
        };


        /* ============================================
           DETERMINATION
        ============================================ */

        const determinationData = context.system.determination?.determination;

        const determinationBaseMax = Math.min(
            10,
            Math.max(0, Math.trunc(Number(determinationData?.max) || 0))
        );

        const determinationMax = getEffectiveDeterminationMax(this.actor, determinationBaseMax);
        const determinationAvailableMax = getAvailableDeterminationMaximum(this.actor, determinationBaseMax);

        const determinationTemp = Math.min(
            determinationAvailableMax,
            Math.max(0, Math.trunc(Number(determinationData?.temp) || 0))
        );

        const determinationLocked = context.system.determination?.locked ?? true;

        // Locked: show only the current maximum number of boxes.
        // Unlocked: show all ten boxes so the maximum can be changed.
        const determinationBoxCount = determinationLocked
            ? determinationBaseMax
            : 10;

        context.determinationLocked = determinationLocked;

        context.determination = {
            max: determinationMax,
            baseMax:determinationBaseMax,
            temp: determinationTemp,

            maxBoxes: Array.from({length: determinationBoxCount}, (_, i) => ({
                value: i + 1,
                checked: i < determinationMax,
                penalized:stabilityValue > 0 && i >= determinationMax && i < determinationBaseMax
            })),

            tempBoxes: Array.from({length: determinationAvailableMax}, (_, i) => ({
                value: i + 1,
                checked: i < determinationTemp,
                disabled: i >= determinationAvailableMax
            }))
        };


        // All derived context must be prepared before this return.
        return context;
    }

    _renderStabilityHistoryContent(history) {
        const groups = new Map();
        for (const entry of history) {
            const name = String(entry.trigger ?? "").trim();
            const key = name.toLocaleLowerCase();
            if (!key) continue;
            const group = groups.get(key) ?? {name, count:0, baseDifficulty:Number(entry.baseDifficulty) || 6};
            group.count += 1;
            group.baseDifficulty = Number(entry.baseDifficulty) || group.baseDifficulty;
            groups.set(key, group);
        }

        const categoryList = groups.size
            ? [...groups.entries()].map(([key, group]) => `
                <li>
                    <span>${foundry.utils.escapeHTML(group.name)} · ${group.count} exposure${group.count === 1 ? "" : "s"} · Trigger difficulty ${group.baseDifficulty}</span>
                    ${this.isEditable ? `<button type="button" data-remove-stability-category="${foundry.utils.escapeHTML(key)}">Remove category</button>` : ""}
                </li>
            `).join("")
            : `<li class="empty">No trigger categories recorded.</li>`;

        const outcomeLabel = entry => getStabilityOutcomeLabel(entry);

        const rollList = history.length
            ? [...history].reverse().map(entry => `
                <li>
                    <strong>${foundry.utils.escapeHTML(String(entry.trigger ?? "Uncategorized trigger"))}</strong>
                    <span>Exposure ${Number(entry.exposure) || 1} · Difficulty ${Number(entry.difficulty) || 6} · ${Number(entry.pool) || 0} dice · ${Number(entry.successes) || 0} successes</span>
                    <span class="${entry.passed ? "passed" : "failed"}">${entry.passed ? "Success" : "Fail"} ${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ""}</span>
                    ${outcomeLabel(entry) ? `<span>${foundry.utils.escapeHTML(outcomeLabel(entry))}</span>` : ""}
                </li>
            `).join("")
            : `<li class="empty">No Stability rolls recorded yet.</li>`;

        return `
            <div class="stability-history-popup">
                <section>
                    <h3>Trigger categories</h3>
                    <ul class="stability-history-categories">${categoryList}</ul>
                </section>
                <section>
                    <h3>Rolls</h3>
                    <ol class="progression-stability-history">${rollList}</ol>
                </section>
            </div>
        `;
    }

    async _openStabilityHistory() {
        const history = Array.from(this.actor.system.determination?.stability?.history ?? []);
        await foundry.applications.api.DialogV2.input({
            classes:["beyond-progression-dialog"],
            window:{title:"Stability History"},
            position:{width:700},
            rejectClose:false,
            content:this._renderStabilityHistoryContent(history),
            render:(event, dialog) => {
                const bindRemoveButtons = () => {
                    dialog.element.querySelectorAll("[data-remove-stability-category]").forEach(button => {
                        button.addEventListener("click", async clickEvent => {
                            clickEvent.preventDefault();
                            clickEvent.stopPropagation();
                            if (!this.isEditable) return;

                            const categoryKey = button.dataset.removeStabilityCategory;
                            const currentHistory = Array.from(this.actor.system.determination?.stability?.history ?? []);
                            const nextHistory = currentHistory.filter(entry =>
                                String(entry.trigger ?? "").trim().toLocaleLowerCase() !== categoryKey
                            );

                            try {
                                await this.actor.update({"system.determination.stability.history":nextHistory});
                                const content = dialog.element.querySelector(".stability-history-popup");
                                if (content) content.outerHTML = this._renderStabilityHistoryContent(nextHistory);
                                bindRemoveButtons();
                            } catch (error) {
                                console.error("Beyond | Could not remove Stability trigger category", error);
                                ui.notifications.error("Could not remove this trigger category.");
                            }
                        });
                    });
                };
                bindRemoveButtons();
            },
            ok:{label:"Close"}
        });
    }

    async _onStabilityRoll() {
        if (!this.isEditable) return;

        const history = Array.from(this.actor.system.determination?.stability?.history ?? []);
        const triggerMap = new Map();
        for (const entry of history) {
            const key = String(entry.trigger ?? "").trim().toLocaleLowerCase();
            if (!key) continue;
            const previous = triggerMap.get(key);
            triggerMap.set(key, {
                name:String(entry.trigger).trim(),
                baseDifficulty:Number(entry.baseDifficulty) || 6,
                exposures:(previous?.exposures ?? 0) + 1
            });
        }
        const triggers = [...triggerMap.values()];
        const triggerOptions = triggers.map((trigger, index) =>
            `<option value="${index}">${foundry.utils.escapeHTML(trigger.name)} (Difficulty ${trigger.baseDifficulty}; ${trigger.exposures} exposure${trigger.exposures === 1 ? "" : "s"})</option>`
        ).join("");
        const stabilityPenalty = getStabilityValue(this.actor) === 1 ? 1 : 0;
        const residuePenalty = this.actor.system.determination?.transgressions?.residuePending === true ? 1 : 0;
        const pool = getEffectiveDeterminationMax(this.actor);
        let selectedStabilitySetup = null;

        const resolveStabilitySetup = (choice, newTriggerValue, newDifficultyValue) => {
            let trigger;
            let baseDifficulty;
            if (String(choice) === "new") {
                trigger = String(newTriggerValue ?? "").trim();
                baseDifficulty = Number(newDifficultyValue);
            } else {
                const selected = triggers[Number(choice)];
                if (!selected) return null;
                trigger = selected.name;
                baseDifficulty = selected.baseDifficulty;
            }

            if (!trigger || !Number.isInteger(baseDifficulty) || baseDifficulty < 3 || baseDifficulty > 10) return null;

            const triggerKey = trigger.toLocaleLowerCase();
            const exposure = history.filter(entry =>
                String(entry.trigger ?? "").trim().toLocaleLowerCase() === triggerKey
            ).length + 1;
            const habituation = exposure >= 3 ? 1 : 0;
            const difficulty = Math.min(
                10,
                Math.max(3, baseDifficulty - habituation) + stabilityPenalty + residuePenalty
            );

            return {trigger, baseDifficulty, exposure, difficulty};
        };

        const extraDialogContent = `
            <div class="stability-roll-setup">
                <label>
                    Trigger category
                    <select name="stabilityTriggerChoice">
                        ${triggerOptions}
                        <option value="new" ${triggers.length ? "" : "selected"}>New trigger category</option>
                    </select>
                </label>
                <div class="stability-roll-new-trigger">
                    <label>
                        New trigger category
                        <input type="text" name="stabilityNewTrigger" maxlength="120" placeholder="Describe the trigger category">
                    </label>
                    <label>
                        Trigger difficulty
                        <input type="number" name="stabilityNewDifficulty" min="3" max="10" step="1" value="6">
                    </label>
                </div>
                <div class="stability-roll-preview">
                    <span>Exposure</span><strong data-stability-exposure>1</strong>
                    <span>Roll difficulty</span><strong data-stability-difficulty>6</strong>
                </div>
                <p>From the third exposure to a trigger category, its difficulty drops by 1, to a minimum of 3. Stability and Residue modifiers are included.</p>
            </div>
        `;

        this._saveScrollPosition();
        const result = await rollD10Pool({
            basePool:pool,
            sheetBonus:0,
            situational:0,
            difficulty:6,
            baseLabel:"Effective Determination",
            bonusLabel:"Stability Modifier",
            label:"Stability Roll",
            actor:this.actor,
            maxPool:10,
            minDifficulty:3,
            maxDifficulty:10,
            allowDifficultyEdit:false,
            allowResourceSpending:false,
            isStabilityRoll:true,
            extraDialogContent,
            hideDifficultyControl:true,
            dialogClasses:["beyond-progression-dialog"],
            difficultyResolver:formData => {
                selectedStabilitySetup = resolveStabilitySetup(
                    formData.stabilityTriggerChoice,
                    formData.stabilityNewTrigger,
                    formData.stabilityNewDifficulty
                );
                return selectedStabilitySetup?.difficulty ?? Number.NaN;
            },
            onDialogRender:(event, dialog) => {
                const root = dialog.element;
                const choice = root.querySelector('[name="stabilityTriggerChoice"]');
                const newTrigger = root.querySelector('[name="stabilityNewTrigger"]');
                const newDifficulty = root.querySelector('[name="stabilityNewDifficulty"]');
                const exposureOutput = root.querySelector("[data-stability-exposure]");
                const difficultyOutput = root.querySelector("[data-stability-difficulty]");

                const updateSetupPreview = () => {
                    const useNew = choice?.value === "new";
                    if (newTrigger) {
                        newTrigger.disabled = !useNew;
                        newTrigger.required = useNew;
                    }
                    if (newDifficulty) {
                        newDifficulty.disabled = !useNew;
                        newDifficulty.required = useNew;
                    }

                    const setup = resolveStabilitySetup(
                        choice?.value,
                        newTrigger?.value,
                        newDifficulty?.value
                    );
                    if (exposureOutput) exposureOutput.textContent = setup ? String(setup.exposure) : "—";
                    if (difficultyOutput) difficultyOutput.textContent = setup ? String(setup.difficulty) : "—";
                };

                choice?.addEventListener("change", updateSetupPreview);
                newTrigger?.addEventListener("input", updateSetupPreview);
                newDifficulty?.addEventListener("input", updateSetupPreview);
                updateSetupPreview();
            }
        });
        if (!result) return;

        if (!selectedStabilitySetup) {
            ui.notifications.warn("Choose or enter a valid trigger category and difficulty.");
            return;
        }

        const {trigger, baseDifficulty, exposure} = selectedStabilitySetup;

        const passed = result.successes >= 1;
        let selectedOutcomes = [];
        let consequenceDialogSubmitted = false;
        const consequenceUpdate = {};

        if (!passed) {
            const determination = this.actor.system.determination?.determination ?? {};
            const currentMaximum = Math.min(10, Math.max(0, Math.trunc(Number(determination.max) || 0)));
            const currentTemporary = Math.min(
                currentMaximum,
                Math.max(0, Math.trunc(Number(determination.temp) || 0))
            );
            const currentStability = getStabilityValue(this.actor);
            const consequenceOptions = [
                {key:"stability", label:"Lose Stability points", amountLabel:"Stability points", maximum:7 - currentStability},
                {key:"derangement", label:"Derangement (add its item manually)", amountLabel:"Derangement items", maximum:10},
                {key:"determinationMax", label:"Lose Maximum Determination", amountLabel:"Maximum Determination", maximum:currentMaximum},
                {key:"determinationTemp", label:"Lose Temporary Determination", amountLabel:"Temporary Determination", maximum:currentTemporary}
            ];
            const consequenceRows = consequenceOptions.map(option => {
                const unavailable = option.maximum <= 0 && option.key !== "derangement";
                const hasModifier = option.key !== "derangement";
                return `
                    <div class="stability-failure-option ${hasModifier ? "" : "no-modifier"}">
                        <label class="stability-failure-option-label">
                            <input type="checkbox" name="${option.key}" data-stability-penalty-toggle="${option.key}" ${unavailable ? "disabled" : ""}>
                            <span>${option.label}${unavailable ? " (unavailable)" : ""}</span>
                        </label>
                        ${hasModifier ? `<input type="number" name="${option.key}Amount" min="1" max="${Math.max(1, option.maximum)}" step="1" value="1" aria-label="${option.amountLabel} modifier" data-stability-penalty-amount="${option.key}" ${unavailable ? "disabled" : ""}>` : ""}
                    </div>
                `;
            }).join("");
            const outcomeData = await foundry.applications.api.DialogV2.input({
                classes:["beyond-progression-dialog"],
                window:{title:"Stability Failure"},
                rejectClose:false,
                content:`
                    <div class="stability-failure-setup">
                        <p>Select any consequences that apply and set each amount.</p>
                        <div class="stability-failure-options">${consequenceRows}</div>
                        <p>Stability loss increases the Stability track. Determination losses reduce their respective tracks. Add any Derangement items manually.</p>
                    </div>
                `
            });

            if (outcomeData) {
                consequenceDialogSubmitted = true;
                const isChecked = value => value === true || value === "true" || value === "on";
                const amountFor = (key, maximum) => {
                    const value = Number(outcomeData[`${key}Amount`]);
                    const amount = Number.isFinite(value) && Number.isInteger(value) ? value : 1;
                    return Math.min(maximum, Math.max(1, amount));
                };
                const selected = consequenceOptions.filter(option =>
                    !((option.maximum <= 0) && option.key !== "derangement") && isChecked(outcomeData[option.key])
                ).map(option => ({
                    ...option,
                    amount:option.key === "derangement" ? 0 : amountFor(option.key, option.maximum)
                }));

                const stabilityPenalty = selected.find(option => option.key === "stability");
                if (stabilityPenalty) {
                    const newStability = currentStability + stabilityPenalty.amount;
                    consequenceUpdate["system.determination.stability.value"] = newStability;
                    selectedOutcomes.push({type:"stability", amount:stabilityPenalty.amount});
                    if (currentStability < 7 && newStability >= 7) {
                        const control = Math.min(4, Math.max(0, Number(this.actor.system.determination?.control?.value) || 0));
                        consequenceUpdate["system.determination.control.value"] = Math.min(4, control + 1);
                        ui.notifications.warn(control >= 3
                            ? "Collapse advances Loss of Control to its final rung."
                            : "Collapse advances Loss of Control by one rung.");
                    }
                }

                const maximumPenalty = selected.find(option => option.key === "determinationMax");
                const newMaximum = currentMaximum - (maximumPenalty?.amount ?? 0);
                if (maximumPenalty) {
                    consequenceUpdate["system.determination.determination.max"] = newMaximum;
                    consequenceUpdate["system.determination.determination.temp"] = Math.min(currentTemporary, newMaximum);
                    selectedOutcomes.push({type:"determinationMax", amount:maximumPenalty.amount});
                }

                const temporaryAfterMaximumLoss = Math.min(currentTemporary, newMaximum);
                const temporaryPenalty = selected.find(option => option.key === "determinationTemp");
                if (temporaryPenalty && temporaryAfterMaximumLoss > 0) {
                    const amount = Math.min(temporaryPenalty.amount, temporaryAfterMaximumLoss);
                    consequenceUpdate["system.determination.determination.temp"] = temporaryAfterMaximumLoss - amount;
                    selectedOutcomes.push({type:"determinationTemp", amount});
                }

                const derangementPenalty = selected.find(option => option.key === "derangement");
                if (derangementPenalty) {
                    selectedOutcomes.push({type:"derangement", amount:0});
                    ui.notifications.info("Add the appropriate Derangement item manually.");
                }
            }
        }

        const nextHistory = foundry.utils.deepClone(
            this.actor.system.determination?.stability?.history ?? []
        );
        nextHistory.push({
            trigger,
            baseDifficulty,
            difficulty:result.difficulty,
            exposure,
            pool:result.pool,
            successes:result.successes,
            passed,
            outcome:selectedOutcomes.length > 1 ? "multiple" : selectedOutcomes[0]?.type ?? (passed ? "none" : consequenceDialogSubmitted ? "none" : "pending"),
            outcomeAmount:selectedOutcomes.length === 1 ? Number(selectedOutcomes[0].amount) || 0 : 0,
            outcomes:selectedOutcomes,
            timestamp:Date.now()
        });

        const update = {
            "system.determination.stability.history":nextHistory,
            ...consequenceUpdate
        };
        if (residuePenalty) update["system.determination.transgressions.residuePending"] = false;

        try {
            await this.actor.update(update);
        } catch (error) {
            console.error("Beyond | Could not save Stability roll history", error);
            ui.notifications.error("Could not save Stability roll history.");
        }
    }

    async _onAdvancePathway(event) {
        if (!this.isEditable) return;

        event.preventDefault();
        this._saveScrollPosition();

        const pathway = this.actor.system.pathway ?? {};
        const currentSequence = Number(pathway.sequence?.number);
        const digestion = Math.min(100, Math.max(0, Math.trunc(Number(pathway.sequence?.digestion) || 0)));
        if (!Number.isInteger(currentSequence) || currentSequence <= 0) {
            ui.notifications.warn("This Actor has no lower Sequence to advance to.");
            return;
        }
        if (digestion < 60) {
            ui.notifications.warn("At least 60 Digestion is required to advance.");
            return;
        }

        try {
            const pathwayItem = await getPathwayItemForActor(this.actor);
            if (!pathwayItem) {
                ui.notifications.error("Could not find the assigned Pathway Item. Reassign the Pathway, then try again.");
                return;
            }

            const targetSequence = currentSequence - 1;
            const sequenceData = Array.from(pathwayItem.system.sequences ?? [])
                .find(sequence => Number(sequence.number) === targetSequence);
            if (!sequenceData) {
                ui.notifications.error(`The assigned Pathway has no data for Sequence ${targetSequence}.`);
                return;
            }

            const profile = pathwayItem.system.profile ?? pathway.pathway?.profile;
            const scaling = getPathwayProfileScaling(profile, targetSequence);
            if (!scaling) {
                ui.notifications.error(`Could not find progression values for the ${profile || "unknown"} Pathway profile.`);
                return;
            }

            const transgressionsGained = Math.floor((100 - digestion) / 10);
            const update = {
                "system.pathway.pathway.name":pathwayItem.name,
                "system.pathway.pathway.profile":profile,
                "system.pathway.sequence.number":targetSequence,
                "system.pathway.sequence.name":sequenceData.name ?? "",
                "system.pathway.sequence.digestion":0,
                "system.pathway.tier":getPathwayTierValue(targetSequence),
                "system.pathway.spirituality.max":scaling.spirituality,
                "system.health.integrity.max":scaling.integrity
            };

            for (const category of ["physical", "social", "mental"]) {
                for (const [attribute, advancement] of Object.entries(sequenceData.attributeAdvancements?.[category] ?? {})) {
                    const prefix = `system.attributes.${category}.${attribute}.advancements`;
                    const currentLevels = Number(foundry.utils.getProperty(this.actor, `${prefix}.pathwayLevels`)) || 0;
                    const addedLevels = Math.max(0, Math.trunc(Number(advancement?.levels) || 0));
                    update[`${prefix}.pathwayLevels`] = Math.min(10, currentLevels + addedLevels);
                    update[`${prefix}.pathwayCeiling`] = advancement?.ceiling == null
                        ? null
                        : Number(advancement.ceiling);
                }
            }

            let trackValue = this.actor.system.determination?.transgressions?.value;
            let track = trackValue == null ? 0 : Math.max(0, Math.trunc(Number(trackValue) || 0));
            let residuePending = this.actor.system.determination?.transgressions?.residuePending === true;
            let ruptures = 0;
            for (let index = 0; index < transgressionsGained; index++) {
                const previous = track;
                track += 1;
                if (previous < 2 && track >= 1 && track < 10) residuePending = true;
                if (track >= 10) {
                    track = 0;
                    residuePending = false;
                    ruptures += 1;
                }
            }
            if (transgressionsGained > 0) {
                update["system.determination.transgressions.value"] = track;
                update["system.determination.transgressions.residuePending"] = residuePending;
            }

            const currentControl = Math.min(4, Math.max(0, Number(this.actor.system.determination?.control?.value) || 0));
            const nextControl = Math.min(4, currentControl + ruptures);
            if (nextControl !== currentControl) {
                update["system.determination.control.value"] = nextControl;
            }

            await this.actor.update(update);

            let grantedPowers = [];
            try {
                grantedPowers = await grantEligibleBeyonderPowers(this.actor, {includeCurrentSequence:true});
            } catch (error) {
                console.error("Beyond | Could not grant Pathway powers after advancement", error);
                ui.notifications.error("The Actor advanced, but Pathway Powers could not be added.");
            }

            const sequenceName = sequenceData.name || `Sequence ${targetSequence}`;
            const transgressionMessage = transgressionsGained
                ? ` Gained ${transgressionsGained} Transgression${transgressionsGained === 1 ? "" : "s"}.`
                : " No Transgressions gained.";
            const powerMessage = grantedPowers.length
                ? ` Added ${grantedPowers.length} Pathway Power${grantedPowers.length === 1 ? "" : "s"}.`
                : "";
            ui.notifications.info(`${pathwayItem.name} advanced to ${sequenceName}.${transgressionMessage}${powerMessage}`);
            if (ruptures > 0) {
                ui.notifications.warn(ruptures > 1
                    ? `Advancement caused ${ruptures} Ruptures and advanced Loss of Control to ${nextControl}.`
                    : `Advancement caused a Rupture and advanced Loss of Control to ${nextControl}.`);
            }
        } catch (error) {
            console.error("Beyond | Could not advance Pathway", error);
            ui.notifications.error("Could not advance this Pathway. Check the configured sequence data and try again.");
        }
    }

    async _onProgressionAdjust(event) {
        if (!this.isEditable) return;

        const button = event.currentTarget;
        const track = button.dataset.progressionAdjust;
        const delta = Number(button.dataset.delta);
        if (![-5, -1, 1, 5].includes(delta)) return;

        try {
            this._saveScrollPosition();

            if (track === "digestion") {
                const current = Math.min(100, Math.max(0, Math.trunc(Number(this.actor.system.pathway?.sequence?.digestion) || 0)));
                const next = Math.min(100, Math.max(0, current + delta));
                if (next === current) return;
                await this.actor.update({"system.pathway.sequence.digestion":next});
                return;
            }

            if (track === "stability") {
                const current = getStabilityValue(this.actor);
                const next = Math.min(7, Math.max(0, current + delta));
                if (next === current) return;

                const update = {"system.determination.stability.value":next};
                if (current < 7 && next === 7) {
                    const control = Math.min(4, Math.max(0, Number(this.actor.system.determination?.control?.value) || 0));
                    update["system.determination.control.value"] = Math.min(4, control + 1);
                    ui.notifications.warn(control >= 3
                        ? "Collapse advances Loss of Control to its final rung."
                        : "Collapse advances Loss of Control by one rung.");
                }
                await this.actor.update(update);
                return;
            }

            if (track !== "transgressions") return;
            const currentRaw = this.actor.system.determination?.transgressions?.value;
            const currentValue = currentRaw === null || currentRaw === undefined ? 0 : Number(currentRaw);
            if (delta < 0 && currentValue <= 0) return;

            const nextCount = Math.max(0, Math.min(10, currentValue + delta));
            const nextValue = delta < 0 && currentValue === 1
                ? null
                : nextCount;
            const update = {"system.determination.transgressions.value":nextValue};

            if (delta > 0) {
                const digestion = Math.max(0, Number(this.actor.system.pathway?.sequence?.digestion) || 0);
                const digestionOverflow = Math.min(19, Math.max(0, Math.trunc(Number(this.actor.system.pathway?.sequence?.digestionOverflow) || 0)));
                const negativeDigestion = Math.max(0, 10 - digestion);
                const overflowTotal = digestionOverflow + negativeDigestion;
                const stabilityGain = Math.floor(overflowTotal / 20);
                update["system.pathway.sequence.digestion"] = Math.max(0, digestion - 10);
                update["system.pathway.sequence.digestionOverflow"] = overflowTotal % 20;

                const initialControl = Math.min(4, Math.max(0, Number(this.actor.system.determination?.control?.value) || 0));
                let control = initialControl;
                let ruptureOccurred = false;
                let collapseReached = false;

                if (stabilityGain > 0) {
                    const currentStability = getStabilityValue(this.actor);
                    const nextStability = Math.min(7, currentStability + stabilityGain);
                    if (nextStability > currentStability) {
                        update["system.determination.stability.value"] = nextStability;
                        if (currentStability < 7 && nextStability === 7) {
                            control = Math.min(4, control + 1);
                            collapseReached = true;
                        }
                    }
                }

                if (currentValue < 2 && nextCount >= 1 && nextCount < 10) {
                    update["system.determination.transgressions.residuePending"] = true;
                }

                if (nextCount >= 10) {
                    update["system.determination.transgressions.value"] = 0;
                    update["system.determination.transgressions.residuePending"] = false;
                    control = Math.min(4, control + 1);
                    ruptureOccurred = true;
                }

                if (control !== initialControl) update["system.determination.control.value"] = control;

                if (ruptureOccurred || collapseReached) {
                    if (ruptureOccurred && collapseReached) {
                        ui.notifications.warn(control >= 4
                            ? "Rupture and Collapse bring Loss of Control to its final rung."
                            : "Rupture and Collapse each advance Loss of Control by one rung.");
                    } else {
                        const reason = ruptureOccurred ? "Rupture" : "Collapse";
                        ui.notifications.warn(control >= 4
                            ? `${reason} advances Loss of Control to its final rung.`
                            : `${reason} advances Loss of Control by one rung.`);
                    }
                }
            } else if (nextCount === 0) {
                update["system.determination.transgressions.residuePending"] = false;
            } else if (currentValue > 2 && nextCount <= 2) {
                update["system.determination.transgressions.residuePending"] = true;
            }

            await this.actor.update(update);
        } catch (error) {
            console.error("Beyond | Could not adjust progression track", error);
            ui.notifications.error("Could not update this progression track.");
        }
    }

    async _onControlRungClick(event, button = event.currentTarget) {
        const rung = Number(button.dataset.controlRung);
        if (!Number.isInteger(rung) || rung < 1 || rung > 4) return;

        const current = Math.min(4, Math.max(0, Number(this.actor.system.determination?.control?.value) || 0));
        const next = current >= rung ? rung - 1 : rung;
        this._saveScrollPosition();
        try {
            await this.actor.update({"system.determination.control.value":next});
        } catch (error) {
            console.error("Beyond | Could not update Loss of Control", error);
            ui.notifications.error("Could not update Loss of Control.");
        }
    }

    async _onProgressionFieldChange(event) {
        if (!this.isEditable) return;

        const field = event.currentTarget;
        const fieldName = field.dataset.progressionField;
        const paths = {
            actingMethod:"system.pathway.actingMethod",
            anchors:"system.pathway.anchors",
            digestion:"system.pathway.sequence.digestion"
        };
        const path = paths[fieldName];
        if (!path) return;

        let value = field.value;
        if (fieldName !== "actingMethod" && fieldName !== "anchors") {
            value = Number(value);

            const maximum = 100;
            const minimum = 0;
            if (value !== null && (!Number.isInteger(value) || value < minimum || value > maximum)) {
                ui.notifications.warn(`${fieldName} must be a whole number from 0 to ${maximum}.`);
                field.value = String(foundry.utils.getProperty(
                    this.actor,
                    path
                ) ?? "");
                return;
            }
        }

        try {
            this._saveScrollPosition();

            await this.actor.update({[path]:value});
        } catch (error) {
            console.error("Beyond | Could not update progression", error);
            ui.notifications.error("Could not save progression changes.");
        }
    }

    async _onClearDigestionOverflow(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isEditable) return;

        const overflow = Math.max(0, Math.trunc(Number(this.actor.system.pathway?.sequence?.digestionOverflow) || 0));
        if (overflow === 0) return;

        this._saveScrollPosition();
        try {
            await this.actor.update({"system.pathway.sequence.digestionOverflow":0});
        } catch (error) {
            console.error("Beyond | Could not clear negative Digestion", error);
            ui.notifications.error("Could not clear negative Digestion.");
        }
    }

    async _onDropItem(event, item) {
        // Let Foundry handle every Item type other than Pathway normally.
        if (item.type !== "Pathway") {
            return super._onDropItem(event, item);
        }

        event.preventDefault();

        try {
            const assignedPathway = await assignPathwayToActor(this.actor, item);

            if (assignedPathway) {
                ui.notifications.info(
                    `${assignedPathway.name} assigned as the character's Pathway.`
                );
            }

            return assignedPathway;
        } catch (error) {
            console.error("Beyond | Could not assign Pathway", error);
            ui.notifications.error("Could not assign this Pathway.");
            return null;
        }
    }


    /* ============================================
       2. RENDER AND EVENT HANDLERS
    ============================================ */

    _onRender(context, options) {
        super._onRender(context, options);

        // Restore currently selected page after rerender.
        const activePage = this._activePage ??
            this.element.querySelector(".field-tab.active")?.dataset.page ??
            "attributes";

        this._activePage = activePage;

        this.element.querySelectorAll(".field-tab").forEach(tab => {
            tab.classList.toggle("active", tab.dataset.page === activePage);
        });

        const sheetPages = [...this.element.querySelectorAll(".sheet-page")];
        this._savedScrollPositions ??= {};
        sheetPages.forEach(section => {
            section.hidden = section.dataset.page !== activePage;
            section.onscroll = () => {
                if (section.dataset.page) {
                    this._savedScrollPositions[section.dataset.page] = section.scrollTop;
                }
            };
        });

        const activePageElement = sheetPages.find(section => section.dataset.page === activePage);
        const savedScrollPosition = this._savedScrollPositions[activePage];
        if (activePageElement && Number.isFinite(savedScrollPosition)) {
            activePageElement.scrollTop = savedScrollPosition;
        }

        this.element.querySelectorAll("[data-progression-field]").forEach(field => {
            if (field.dataset.progressionField === "digestion") {
                field.addEventListener("input", event => {
                    const digestion = Math.min(100, Math.max(0, Math.trunc(Number(event.currentTarget.value) || 0)));
                    const section = event.currentTarget.closest(".progression-digestion-field");
                    const image = section?.querySelector("[data-digestion-image]");
                    const value = section?.querySelector("[data-digestion-value]");
                    if (image) {
                        image.src = getDigestionImagePath(digestion);
                        image.alt = `Digestion: ${digestion} out of 100`;
                    }
                    if (value) value.textContent = `${digestion} / 100`;
                    event.currentTarget.style.setProperty("--digestion-fill", `${digestion}%`);
                });
            }
            field.addEventListener("change", event => this._onProgressionFieldChange(event));
        });

        this.element.querySelectorAll("[data-progression-adjust]").forEach(button => {
            button.addEventListener("click", event => {
                event.preventDefault();
                void this._onProgressionAdjust(event);
            });
        });

        this.element.querySelector("[data-advance-pathway]")?.addEventListener("click", event => {
            void this._onAdvancePathway(event);
        });

        this.element.querySelector("[data-clear-digestion-overflow]")?.addEventListener("contextmenu", event => {
            void this._onClearDigestionOverflow(event);
        });

        if (this._controlRungClickHandler) {
            this.element.removeEventListener("click", this._controlRungClickHandler, true);
        }
        this._controlRungClickHandler = event => {
            const button = event.target?.closest?.("[data-control-rung]");
            if (!button || !this.element.contains(button)) return;
            event.preventDefault();
            event.stopPropagation();
            void this._onControlRungClick(event, button);
        };
        this.element.addEventListener("click", this._controlRungClickHandler, true);

        this.element.querySelector("[data-stability-roll]")?.addEventListener("click", event => {
            event.preventDefault();
            void this._onStabilityRoll();
        });

        this.element.querySelector("[data-open-stability-history]")?.addEventListener("click", event => {
            event.preventDefault();
            void this._openStabilityHistory();
        });


        /* ============================================
           ATTRIBUTE, ABILITY AND BACKGROUND DOTS
        ============================================ */

        this.element.querySelectorAll(
            ".attribute-dot input, .ability-dot input, .background-dot input"
        ).forEach(input => {
            input.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                const path = event.currentTarget.dataset.path;

                if (path.startsWith("system.attributes.") && this.actor.system.attributes.locked) return;
                if (path.startsWith("system.abilities.") && this.actor.system.abilities.locked) return;
                if (path.startsWith("system.backgrounds.") && this.actor.system.backgrounds.locked) return;

                this._saveScrollPosition();

                await this.actor.update({
                    [path]: Number(event.currentTarget.value)
                });
            });
        });


        /* ============================================
           RIGHT-CLICK ABILITY DOT TO RESET
        ============================================ */

        this.element.querySelectorAll(".ability-dot").forEach(dot => {
            dot.addEventListener("contextmenu", async event => {
                event.preventDefault();
                event.stopPropagation();

                if (this.actor.system.abilities.locked) return;

                this._saveScrollPosition();

                const input = dot.querySelector("input");

                await this.actor.update({
                    [input.dataset.path]: 0
                });
            });
        });


        /* ============================================
           RIGHT-CLICK BACKGROUND DOT TO RESET
        ============================================ */

        this.element.querySelectorAll(".background-dot").forEach(dot => {
            dot.addEventListener("contextmenu", async event => {
                event.preventDefault();
                event.stopPropagation();

                if (this.actor.system.backgrounds.locked) return;

                this._saveScrollPosition();

                const input = dot.querySelector("input");

                await this.actor.update({
                    [input.dataset.path]: 0
                });
            });
        });


        /* ============================================
           ATTRIBUTE AND ABILITY BONUS BUTTONS
        ============================================ */

        this.element.querySelectorAll(
            ".attribute-bonus-button, .ability-bonus-button"
        ).forEach(button => {
            button.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                this._saveScrollPosition();

                const control = event.currentTarget.closest(
                    ".attribute-bonus-control, .ability-bonus-control"
                );

                const input = control.querySelector("input");
                const path = input.name;

                const currentValue = Number(
                    foundry.utils.getProperty(
                        this.actor.system,
                        path.replace(/^system\./, "")
                    )
                ) || 0;

                const change = Number(event.currentTarget.dataset.delta);

                await this.actor.update({
                    [path]: currentValue + change
                });
            });
        });


        /* ============================================
           IMPORTANCE SELECTIONS
        ============================================ */

        this.element.querySelectorAll(".category-importance input").forEach(input => {
            input.addEventListener("change", async event => {
                event.preventDefault();
                event.stopPropagation();

                const path = event.currentTarget.name;

                if (path.startsWith("system.attributes.") && this.actor.system.attributes.locked) return;
                if (path.startsWith("system.abilities.") && this.actor.system.abilities.locked) return;

                this._saveScrollPosition();

                await this.actor.update({
                    [path]: event.currentTarget.value
                });
            });
        });


        /* ============================================
           SECTION LOCKS
        ============================================ */

        this.element.querySelectorAll("[data-lock]").forEach(input => {
            input.addEventListener("change", async event => {
                const section = event.currentTarget.dataset.lock;
                const locked = event.currentTarget.checked;

                this._saveScrollPosition();

                await this.actor.update({
                    [`system.${section}.locked`]: locked
                });
            });
        });


        /* ============================================
           RESET ALL BONUSES IN A SECTION
        ============================================ */

        this.element.querySelectorAll("[data-reset-bonuses]").forEach(button => {
            button.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                const section = event.currentTarget.dataset.resetBonuses;
                const update = {};

                for (const [category, entries] of Object.entries(this.actor.system[section])) {
                    if (category === "locked") continue;

                    for (const [name, entry] of Object.entries(entries)) {
                        if (name === "importance" || !entry || typeof entry !== "object") continue;
                        if (!("bonus" in entry)) continue;

                        update[`system.${section}.${category}.${name}.bonus`] = 0;
                    }
                }

                await this.actor.update(update);
            });
        });


        /* ============================================
           NAVIGATION TABS
        ============================================ */

        this.element.querySelectorAll(".field-tab").forEach(button => {
            button.addEventListener("click", event => {
                event.preventDefault();

                const page = event.currentTarget.dataset.page;
                this._saveScrollPosition();
                this._activePage = page;

                this.element.querySelectorAll(".field-tab").forEach(tab => {
                    tab.classList.toggle("active", tab.dataset.page === page);
                });

                this.element.querySelectorAll(".sheet-page").forEach(section => {
                    section.hidden = section.dataset.page !== page;
                });

                const selectedPage = [...this.element.querySelectorAll(".sheet-page")]
                    .find(section => section.dataset.page === page);
                const savedScrollPosition = this._savedScrollPositions?.[page];
                if (selectedPage && Number.isFinite(savedScrollPosition)) {
                    selectedPage.scrollTop = savedScrollPosition;
                }
            });
        });


        /* ============================================
           CHANGE ACTOR PORTRAIT
        ============================================ */

        const portrait = this.element.querySelector('[data-action="edit-portrait"]');

        portrait?.addEventListener("click", event => {
            event.preventDefault();

            new FilePicker({
                type: "image",
                current: this.actor.img,
                callback: async path => {
                    await this.actor.update({img: path});
                }
            }).render(true);
        });


        /* ============================================
           INTEGRITY DAMAGE CONTROLS
        ============================================ */

        const changeIntegrityDamage = async (direction, targetIndex) => {
            const integrity = this.actor.system.health.integrity;
            const damage = this.actor.system.health.damage;
            const max = integrity.max;

            let bashing = Number(damage.bashing) || 0;
            let lethal = Number(damage.lethal) || 0;
            let aggravated = Number(damage.aggravated) || 0;

            const boxes = Array.from({length: max}, (_, i) =>
                i < aggravated ? "aggravated" :
                i < aggravated + lethal ? "lethal" :
                i < aggravated + lethal + bashing ? "bashing" : "empty"
            );

            let changedIndex = -1;

            if (direction > 0) {
                const prefix = boxes.slice(0, targetIndex + 1);

                changedIndex = prefix.findIndex(type => type === "empty");
                if (changedIndex === -1) changedIndex = prefix.findIndex(type => type === "bashing");
                if (changedIndex === -1) changedIndex = prefix.findIndex(type => type === "lethal");

                if (changedIndex !== -1) {
                    boxes[changedIndex] = {
                        empty: "bashing",
                        bashing: "lethal",
                        lethal: "aggravated"
                    }[boxes[changedIndex]];
                }
            } else {
                for (let i = targetIndex; i >= 0; i--) {
                    if (boxes[i] !== "empty") {
                        changedIndex = i;
                        break;
                    }
                }

                if (changedIndex !== -1) {
                    boxes[changedIndex] = {
                        aggravated: "lethal",
                        lethal: "bashing",
                        bashing: "empty"
                    }[boxes[changedIndex]];
                }
            }

            if (changedIndex === -1) return;

            bashing = boxes.filter(type => type === "bashing").length;
            lethal = boxes.filter(type => type === "lethal").length;
            aggravated = boxes.filter(type => type === "aggravated").length;

            this._saveScrollPosition();

            await this.actor.update({
                "system.health.damage.bashing": bashing,
                "system.health.damage.lethal": lethal,
                "system.health.damage.aggravated": aggravated
            });
        };

        this.element.querySelectorAll(".integrity-boxes > .integrity-box").forEach(box => {
            box.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                const index = Number(event.currentTarget.dataset.index);
                if (Number.isInteger(index)) await changeIntegrityDamage(1, index);
            });

            box.addEventListener("contextmenu", async event => {
                event.preventDefault();
                event.stopPropagation();

                const index = Number(event.currentTarget.dataset.index);
                if (Number.isInteger(index)) await changeIntegrityDamage(-1, index);
            });
        });


        /* ============================================
           SPIRITUALITY CONTROLS
        ============================================ */

        this.element.querySelectorAll(".spirituality-box").forEach(box => {
            box.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                if (!this.isEditable) return;

                const clickedValue = Number(event.currentTarget.dataset.value);
                const spirituality = this.actor.system.pathway?.spirituality;

                const max = Math.min(
                    20,
                    Math.max(0, Math.trunc(Number(spirituality?.max) || 0))
                );

                const currentValue = Math.min(
                    max,
                    Math.max(0, Math.trunc(Number(spirituality?.value) || 0))
                );

                if (
                    max === 0 ||
                    !Number.isInteger(clickedValue) ||
                    clickedValue < 1 ||
                    clickedValue > max
                ) return;

                let newValue;

                if (currentValue === 0) {
                    // Empty: clicking any box fills the first box.
                    newValue = 1;
                } else if (currentValue === max) {
                    // Full: clicking any box removes the last filled box.
                    newValue = max - 1;
                } else if (clickedValue > currentValue) {
                    // Clicking above the current value adds one.
                    newValue = currentValue + 1;
                } else {
                    // Clicking at or below the current value removes one.
                    newValue = currentValue - 1;
                }

                this._saveScrollPosition();

                await this.actor.update({
                    "system.pathway.spirituality.value": newValue
                });
            });
        });


        /* ============================================
           DETERMINATION CONTROLS
        ============================================ */

        this.element.querySelectorAll(".determination-box").forEach(box => {
            box.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                if (!this.isEditable) return;

                const track = event.currentTarget.dataset.track;
                const clickedValue = Number(event.currentTarget.dataset.value);
                const determination = this.actor.system.determination?.determination;
                const locked = this.actor.system.determination?.locked ?? true;

                const max = Math.min(
                    10,
                    Math.max(0, Math.trunc(Number(determination?.max) || 0))
                );

                const temp = Math.min(
                    getAvailableDeterminationMaximum(this.actor, max),
                    Math.max(0, Math.trunc(Number(determination?.temp) || 0))
                );

                if (
                    !Number.isInteger(clickedValue) ||
                    clickedValue < 1 ||
                    clickedValue > 10
                ) return;

                this._saveScrollPosition();

                if (track === "max") {
                    // Maximum can only be changed while its section is unlocked.
                    if (locked) return;

                    const newMax = clickedValue;
                    const newTemp = Math.min(
                        Math.max(0, Math.trunc(Number(determination?.temp) || 0)),
                        newMax
                    );

                    await this.actor.update({
                        "system.determination.determination.max": newMax,
                        "system.determination.determination.temp": newTemp
                    });

                } else if (track === "temp") {
                    // Temporary cannot exceed the stability-adjusted maximum.
                    if (clickedValue > getAvailableDeterminationMaximum(this.actor, max)) return;

                    await this.actor.update({
                        "system.determination.determination.temp": clickedValue
                    });
                }
            });

            // Right-click resets the selected track.
            box.addEventListener("contextmenu", async event => {
                event.preventDefault();
                event.stopPropagation();

                if (!this.isEditable) return;

                const track = event.currentTarget.dataset.track;
                const locked = this.actor.system.determination?.locked ?? true;

                this._saveScrollPosition();

                if (track === "max") {
                    if (locked) return;

                    await this.actor.update({
                        "system.determination.determination.max": 0,
                        "system.determination.determination.temp": 0
                    });

                } else if (track === "temp") {
                    await this.actor.update({
                        "system.determination.determination.temp": 0
                    });
                }
            });
        });


        /* ============================================
           OPEN OWNED BEYONDER POWERS
        ============================================ */

        this.element.querySelectorAll("[data-open-beyonder-power]").forEach(button => {
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                const power = this.actor.items.get(event.currentTarget.dataset.openBeyonderPower);
                power?.sheet?.render(true);
            });
        });

        this.element.querySelectorAll("[data-remove-beyonder-power]").forEach(button => {
            button.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                const powerId = event.currentTarget.dataset.removeBeyonderPower;
                const power = this.actor.items.get(powerId);
                if (!power) return;

                try {
                    const grantSourceUuid = power.flags?.Beyond?.pathwayPowerGrant?.sourceUuid;
                    const removedSourceUuids = new Set(
                        await this.actor.getFlag("Beyond", "removedBeyonderPowerSources") ?? []
                    );
                    const removedPowerKeys = new Set(
                        await this.actor.getFlag("Beyond", "removedBeyonderPowerKeys") ?? []
                    );

                    if (grantSourceUuid) removedSourceUuids.add(grantSourceUuid);
                    else removedPowerKeys.add([
                        String(power.system.pathwayName ?? "").trim().toLocaleLowerCase(),
                        Number(power.system.sequence),
                        String(power.name ?? "").trim().toLocaleLowerCase()
                    ].join("|"));

                    await this.actor.setFlag("Beyond", "removedBeyonderPowerSources", [...removedSourceUuids]);
                    await this.actor.setFlag("Beyond", "removedBeyonderPowerKeys", [...removedPowerKeys]);
                    await this.actor.deleteEmbeddedDocuments("Item", [power.id]);
                    ui.notifications.info(`${power.name} removed from ${this.actor.name}.`);
                } catch (error) {
                    console.error("Beyond | Could not remove Beyonder Power", error);
                    ui.notifications.error("Could not remove this Beyonder Power.");
                }
            });
        });


        /* ============================================
           ATTRIBUTE AND ABILITY ROLLS
        ============================================ */

        this.element.querySelectorAll(
            ".attribute-name[data-roll-type], .ability-name[data-roll-type]"
        ).forEach(element => {
            element.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                const type = event.currentTarget.dataset.rollType;
                const category = event.currentTarget.dataset.category;
                const name = event.currentTarget.dataset.name;

                const record = type === "attribute"
                    ? this.actor.system.attributes?.[category]?.[name]
                    : this.actor.system.abilities?.[category]?.[name];

                if (!record) {
                    console.warn(`Beyond | Could not find ${type}: ${category}.${name}`);
                    return;
                }

                let basePool = 0;
                let sheetBonus = 0;
                let attributeSelector = null;
                let attributeKey = null;
                let abilityValue = null;
                let relevantPowers = [];
                let untrained = false;
                let baseLabel = "Base Pool";
                let bonusLabel = "Sheet Bonus";
                let label = "";

                if (type === "attribute") {
                    const conditionPenalty = category === "physical"
                        ? Number(this._conditionPenalty) || 0
                        : 0;

                    attributeKey = name;
                    basePool = Number(record.value) || 0;
                    sheetBonus = (Number(record.bonus) || 0) + conditionPenalty;
                    label = `${name.charAt(0).toUpperCase() + name.slice(1)} Roll`;

                    const currentSequence = this.actor.system.pathway?.sequence?.number;
                    relevantPowers = this.actor.items
                        .filter(power => power.type === "BeyonderPower")
                        .map(power => ({
                            id:power.id,
                            name:power.name,
                            abilityModifier:0,
                            attributeModifiers:getBeyonderPowerAttributeModifiers(power.system, currentSequence),
                            versionSequence:getEffectivePowerSequence(power.system, currentSequence)
                        }))
                        .filter(power => power.attributeModifiers.some(attribute => attribute.key === attributeKey && attribute.modifier !== 0));

                } else {
                    abilityValue = Number(record.value) || 0;
                    const abilityBonus = Number(record.bonus) || 0;
                    const abilityLabel = name.charAt(0).toUpperCase() + name.slice(1);
                    untrained = abilityValue === 0;

                    const abilityKey = `${category}.${name}`;
                    const currentSequence = this.actor.system.pathway?.sequence?.number;
                    relevantPowers = this.actor.items
                        .filter(power => power.type === "BeyonderPower")
                        .map(power => {
                            const abilityModifier = getBeyonderPowerAbilityModifiers(power.system, currentSequence)
                                .find(ability => ability.key === abilityKey)?.modifier ?? 0;
                            const attributeModifiers = getBeyonderPowerAttributeModifiers(power.system, currentSequence);
                            return {
                                id:power.id,
                                name:power.name,
                                abilityModifier,
                                attributeModifiers,
                                versionSequence:getEffectivePowerSequence(power.system, currentSequence)
                            };
                        })
                        .filter(power => power.abilityModifier !== 0 || power.attributeModifiers.some(attribute => attribute.modifier !== 0));

                    // Untrained Knowledges automatically fail.
                    if (category === "knowledges" && untrained) {
                        this._saveScrollPosition();

                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({actor: this.actor}),
                            content: `
                                <div class="beyond-roll-card beyond-auto-failure">
                                    <div class="beyond-roll-header">
                                        <h2>${foundry.utils.escapeHTML(abilityLabel)} Roll</h2>
                                    </div>
                                    <div class="beyond-roll-successes automatic-failure">
                                        <span>RESULT</span>
                                        <strong>Automatic Failure</strong>
                                        <span>No points in this Knowledge</span>
                                    </div>
                                </div>
                            `
                        });

                        return;
                    }

                    // Attribute score is a separate pool component.
                    // Attribute bonus is deliberately NOT included.
                    attributeSelector = {
                        selected: "strength",
                        options: ABILITY_ATTRIBUTE_OPTIONS.map(attribute => {
                            const attributeRecord = this.actor.system.attributes?.[
                                attribute.category
                            ]?.[attribute.key];

                            const attributeValue = Number(attributeRecord?.value) || 0;

                            const conditionPenalty = attribute.category === "physical"
                                ? Number(this._conditionPenalty) || 0
                                : 0;

                            // Untrained Skills receive -1. Talents receive no penalty.
                            const untrainedPenalty = category === "skills" && untrained ? -1 : 0;

                            return {
                                value: attribute.key,
                                label: attribute.label,
                                attributeValue,
                                sheetBonus: abilityBonus + conditionPenalty + untrainedPenalty
                            };
                        })
                    };

                    const initialAttribute = attributeSelector.options.find(
                        option => option.value === attributeSelector.selected
                    );

                    basePool = abilityValue;
                    sheetBonus = initialAttribute.sheetBonus;
                    baseLabel = "Base Pool";
                    bonusLabel = "Ability Bonus";
                    label = `${abilityLabel} Roll`;
                }

                this._saveScrollPosition();

                await rollD10Pool({
                    basePool,
                    sheetBonus,
                    situational: 0,
                    difficulty: 6,
                    label,
                    actor: this.actor,
                    maxPool: 100,
                    allowDifficultyEdit: true,
                    baseLabel,
                    bonusLabel,
                    attributeSelector,
                    attributeKey,
                    abilityValue,
                    untrained,
                    relevantPowers
                });
            });
        });

        this.element.querySelectorAll("[data-favorite-beyonder-power]").forEach(button => {
        button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();

            const powerId = event.currentTarget.dataset.favoriteBeyonderPower;
            if (!powerId || !this.isEditable) return;

            const favorites = new Set(
                this.actor.getFlag("Beyond", "favoriteBeyonderPowers") ?? []
            );

            if (favorites.has(powerId)) favorites.delete(powerId);
            else favorites.add(powerId);

            try {
                this._saveScrollPosition();
                await this.actor.setFlag(
                    "Beyond",
                    "favoriteBeyonderPowers",
                    [...favorites]
                );
            } catch (error) {
                console.error("Beyond | Could not update Beyonder Power favorite", error);
                ui.notifications.error("Could not update this power's favorite status.");
            }
        });
        });
    }
}
