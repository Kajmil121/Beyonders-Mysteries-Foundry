
/* ============================================
   BEYONDERS & MYSTERIES
   GENERAL D10 ROLLING SYSTEM
============================================ */

import {
    getAvailableDeterminationMaximum,
    getEffectiveDeterminationMax,
    getLossOfControlDifficultyPenalty,
    getSequenceDifficultyPenalty,
    getSequenceStabilityPoolPenalty,
    getStabilityPoolPenalty,
    getStabilityValue
} from "../actor/progressionRules.js";


/* ============================================
   1. SUCCESS CALCULATION
============================================ */

/**
 * Get active individual die results from a Foundry Roll.
 */
function getActiveResults(roll) {
    return roll.dice.flatMap(die => die.results)
        .filter(result => result.active !== false && !result.discarded)
        .map(result => result.result);
}


/**
 * Calculate successes using Beyonders & Mysteries rules.
 *
 * - Results meeting difficulty: 1 success.
 * - Results of 10: 2 successes.
 * - Results of 1: cancel 1 success.
 * - Successes cannot fall below 0.
 */
export function evaluateSuccesses(roll, difficulty) {
    const results = getActiveResults(roll);

    const ones = results.filter(result => result === 1).length;
    const tens = results.filter(result => result === 10).length;

    const regularSuccesses = results.filter(result =>
        result >= difficulty &&
        result !== 1 &&
        result !== 10
    ).length;

    const successesBeforeCancellation = regularSuccesses + (tens * 2);
    const cancelledSuccesses = Math.min(ones, successesBeforeCancellation);
    const successes = Math.max(0, successesBeforeCancellation - ones);

    return {
        successes,
        regularSuccesses,
        tens,
        ones,
        cancelledSuccesses,
        results
    };
}


/**
 * Simple success counter for other system modules.
 */
export function countSuccesses(roll, difficulty) {
    return evaluateSuccesses(roll, difficulty).successes;
}


/* ============================================
   2. GENERAL D10 ROLLER
============================================ */

export async function rollD10Pool({
    basePool = null,
    pool = 1,
    sheetBonus = 0,
    situational = 0,
    difficulty = 6,
    baseLabel = "Base Pool",
    bonusLabel = "Sheet Bonus",
    attributeSelector = null,
    attributeKey = null,
    abilityValue = null,
    untrained = false,
    relevantPowers = [],
    label = "Dice Roll",
    actor = null,
    maxPool = 100,
    minDifficulty = 1,
    maxDifficulty = 10,
    allowDifficultyEdit = true,
    allowResourceSpending = true,
    isSequenceRoll = false,
    isLossOfControlRoll = false,
    isStabilityRoll = false,
    extraDialogContent = "",
    hideDifficultyControl = false,
    difficultyResolver = null,
    onDialogRender = null,
    dialogClasses = []
} = {}) {


    /* ============================================
       3. INITIAL DICE POOL VALUES
    ============================================ */

    const isAbilityRoll = abilityValue !== null && abilityValue !== undefined;

    const initialAbilityValue = isAbilityRoll
        ? Math.max(0, Math.trunc(Number(abilityValue) || 0))
        : null;

    const showUntrained = isAbilityRoll &&
        (untrained || initialAbilityValue === 0);

    // Attribute choices contain the Attribute's actual score,
    // plus the Ability bonus and applicable penalties.
    const attributeOptions = Array.isArray(attributeSelector?.options)
        ? attributeSelector.options.map(option => ({
            value: String(option.value),
            label: String(option.label),
            attributeValue: Math.max(0, Math.trunc(Number(option.attributeValue) || 0)),
            sheetBonus: Math.trunc(Number(option.sheetBonus) || 0)
        }))
        : [];

    const hasAttributeSelector = isAbilityRoll && attributeOptions.length > 0;

    const requestedAttribute = String(attributeSelector?.selected ?? "");

    let selectedAttributeOption = attributeOptions.find(
        option => option.value === requestedAttribute
    ) ?? attributeOptions[0] ?? null;

    if (isAbilityRoll && !selectedAttributeOption) {
        console.error("Beyond | Ability roll requires at least one Attribute option.");
        ui.notifications.error("Could not prepare the Ability roll: no Attributes were provided.");
        return null;
    }

    // A power may apply through the selected Ability, the selected Attribute, or both.
    // When both are configured, their modifiers add together for that single power.
    const getPowerOptionsForAttribute = selectedKey => (Array.isArray(relevantPowers) ? relevantPowers : [])
        .map(power => {
            const hasStructuredModifiers = Array.isArray(power.attributeModifiers) || power.abilityModifier !== undefined;
            const abilityModifier = isAbilityRoll
                ? Math.trunc(Number(power.abilityModifier ?? (!hasStructuredModifiers ? power.modifier : 0)) || 0)
                : 0;
            const attributeSetting = power.attributeModifiers?.find(attribute => attribute.key === selectedKey);
            const selectedAttributeModifier = Math.trunc(Number(attributeSetting?.modifier) || 0);
            const modifier = abilityModifier + selectedAttributeModifier;
            const sources = [];

            if (abilityModifier !== 0) sources.push(`Ability ${abilityModifier < 0 ? "−" : "+"}${Math.abs(abilityModifier)}`);
            if (selectedAttributeModifier !== 0) {
                sources.push(`${attributeSetting.label} ${selectedAttributeModifier < 0 ? "−" : "+"}${Math.abs(selectedAttributeModifier)}`);
            }

            return {
                id:String(power.id ?? power.name ?? ""),
                name:String(power.name ?? "Beyonder Power"),
                modifier,
                sourceDescription:sources.join("; ")
            };
        })
        .filter(power => power.modifier !== 0);

    let powerOptions = getPowerOptionsForAttribute(
        isAbilityRoll ? selectedAttributeOption?.value : attributeKey
    );

    // Attribute rolls use the same optional power selector as Ability rolls.
    const hasPowerCandidates = Array.isArray(relevantPowers) && relevantPowers.length > 0;

    let currentAttributeValue = isAbilityRoll
        ? selectedAttributeOption.attributeValue
        : 0;

    // For Ability rolls, the Ability rating is the Base Pool.
    // The Attribute score is added separately.
    let currentBasePool = isAbilityRoll
        ? initialAbilityValue
        : Math.min(
            maxPool,
            Math.max(0, Math.trunc(Number(basePool ?? pool) || 0))
        );

    let currentSheetBonus = isAbilityRoll
        ? selectedAttributeOption.sheetBonus
        : Math.trunc(Number(sheetBonus) || 0);

    const initialSituational = Math.trunc(Number(situational) || 0);


    /* ============================================
       4. AVAILABLE RESOURCES
    ============================================ */

    const spiritualityAvailable = allowResourceSpending ? Math.max(
        0,
        Math.trunc(Number(actor?.system?.pathway?.spirituality?.value) || 0)
    ) : 0;

    const determinationAvailable = allowResourceSpending ? Math.max(
        0,
        Math.min(
            Math.trunc(Number(actor?.system?.determination?.determination?.temp) || 0),
            getAvailableDeterminationMaximum(actor)
        )
    ) : 0;


    /* ============================================
       5. DICE POOL CALCULATION
    ============================================ */

    const calculateTotal = (
        base,
        attributeScore,
        bonus,
        modifier,
        spiritualitySpent = 0,
        powerModifier = 0
        ) => Math.min(
        maxPool,
        Math.max(
            0,
                base + attributeScore + bonus + modifier + spiritualitySpent + powerModifier +
                    getStabilityPoolPenalty(actor, isAbilityRoll ? selectedAttributeOption?.value : attributeKey) +
                    (isSequenceRoll ? getSequenceStabilityPoolPenalty(actor) : 0)
        )
    );

    const initialTotal = calculateTotal(
        currentBasePool,
        currentAttributeValue,
        currentSheetBonus,
        initialSituational,
        0
    );

    const getApplicableRollEffects = selectedKey => {
        const effects = [];
        const stability = getStabilityValue(actor);
        const stabilityPoolPenalty = getStabilityPoolPenalty(actor, selectedKey);
        const selectedAttribute = attributeOptions.find(option => option.value === selectedKey);

        if (stabilityPoolPenalty) {
            const attributeLabel = selectedAttribute?.label ?? String(selectedKey ?? "").replaceAll(".", " ");
            effects.push({
                source:"Stability",
                description:`${Math.abs(stabilityPoolPenalty)} fewer dice on ${attributeLabel} rolls.`
            });
        }

        if (isSequenceRoll && getSequenceStabilityPoolPenalty(actor)) {
            effects.push({source:"Stability", description:"1 fewer die on Sequence rolls."});
        }

        if (isSequenceRoll && getSequenceDifficultyPenalty(actor)) {
            effects.push({source:"Dissonance", description:"+1 difficulty on this Sequence roll."});
        }

        if (isLossOfControlRoll && getLossOfControlDifficultyPenalty(actor)) {
            effects.push({source:"Dissonance", description:"+1 difficulty against Loss of Control."});
        }

        if (isStabilityRoll) {
            if (stability === 1) {
                effects.push({source:"Tense", description:"+1 difficulty on this Stability roll."});
            }
            if (actor?.system?.determination?.transgressions?.residuePending === true) {
                effects.push({source:"Residue", description:"+1 difficulty on this next Stability roll."});
            }

            if (stability > 0 && actor) {
                const baseMaximum = Math.max(0, Math.trunc(Number(actor.system?.determination?.determination?.max) || 0));
                const effectiveMaximum = getEffectiveDeterminationMax(actor, baseMaximum);
                effects.push({
                    source:"Stability",
                    description:`Stability roll pool uses Effective Determination: ${effectiveMaximum} (base ${baseMaximum}).`
                });
            }
        }

        if (allowResourceSpending && stability > 0 && actor) {
            const baseMaximum = Math.max(0, Math.trunc(Number(actor.system?.determination?.determination?.max) || 0));
            const effectiveMaximum = getEffectiveDeterminationMax(actor, baseMaximum);
            if (stability >= 7) {
                effects.push({source:"Collapse", description:"Temporary Determination is unavailable."});
            } else {
                effects.push({
                    source:"Stability",
                    description:`Determination spending is capped at ${effectiveMaximum} (base maximum ${baseMaximum}).`
                });
            }
        }

        if (!effects.length) return "";
        return `
            <section class="beyond-roll-effects">
                <h3>Active Stability and Transgression Effects</h3>
                <ul>
                    ${effects.map(effect => `
                        <li><strong>${foundry.utils.escapeHTML(effect.source)}</strong><span>${foundry.utils.escapeHTML(effect.description)}</span></li>
                    `).join("")}
                </ul>
            </section>
        `;
    };

    const initialEffectAttribute = isAbilityRoll
        ? selectedAttributeOption?.value
        : attributeKey;


    /* ============================================
       6. DIFFICULTY CONFIGURATION
    ============================================ */

    const presetDifficulties = [4, 6, 8, 10];

    const rollDifficultyPenalty = isSequenceRoll
        ? getSequenceDifficultyPenalty(actor)
        : isLossOfControlRoll
            ? getLossOfControlDifficultyPenalty(actor)
            : 0;

    const initialDifficulty = Math.min(
        maxDifficulty,
        Math.max(minDifficulty, Math.trunc(Number(difficulty) || 6) + rollDifficultyPenalty)
    );

    const initialDifficultyChoice = presetDifficulties.includes(initialDifficulty)
        ? String(initialDifficulty)
        : "custom";
    const initialCustomDifficulty = initialDifficultyChoice === "custom"
        ? String(initialDifficulty)
        : "";


    /* ============================================
       7. ATTRIBUTE DROPDOWN HTML
    ============================================ */

    const attributeSelectorHTML = hasAttributeSelector
        ? `
            <div class="beyond-roll-attribute-select">
                <label for="beyond-attribute-select">Attribute</label>

                <select id="beyond-attribute-select" name="selectedAttribute">
                    ${attributeOptions.map(option => `
                        <option
                            value="${foundry.utils.escapeHTML(option.value)}"
                            ${option.value === selectedAttributeOption.value ? "selected" : ""}
                        >
                            ${foundry.utils.escapeHTML(option.label)}
                        </option>
                    `).join("")}
                </select>
            </div>
        `
        : "";

    const renderPowerOptionRows = options => options.length
        ? options.map((power, index) => `
            <label class="beyond-roll-power-option" title="${foundry.utils.escapeHTML(power.sourceDescription)}">
                <input type="checkbox" data-power-checkbox="${index}" data-power-modifier="${power.modifier}">
                <span>${foundry.utils.escapeHTML(power.name)}</span>
                <strong>${power.modifier < 0 ? "−" : "+"}${Math.abs(power.modifier)}</strong>
            </label>
            <input type="hidden" name="selectedPower_${index}" value="0">
        `).join("")
        : `<p class="beyond-roll-no-powers">No powers apply to this Attribute.</p>`;

    const powerOptionsHTML = hasPowerCandidates
        ? `
            <fieldset class="beyond-roll-powers">
                <legend>Relevant Beyonder Powers</legend>
                <div class="beyond-roll-power-options" data-power-options-list>
                    ${renderPowerOptionRows(powerOptions)}
                </div>
                <div class="beyond-roll-power-total">
                    Selected power modifier: <strong data-selected-power-modifier>0</strong>
                </div>
            </fieldset>
        `
        : "";


    /* ============================================
       8. ROLL CONFIGURATION DIALOG
    ============================================ */

    let formData;

    try {
        formData = await foundry.applications.api.DialogV2.input({
            classes: ["beyond-roll-dialog", ...dialogClasses],

            window: {
                title: label
            },

            position: {
                width: 760
            },

            rejectClose: false,

            content: `
                <div class="beyond-roll-content">

                    ${extraDialogContent}
                    <div data-roll-effects-container>${getApplicableRollEffects(initialEffectAttribute)}</div>
                    ${attributeSelectorHTML}
                    ${powerOptionsHTML}

                    <!-- DICE POOL EQUATION -->

                    <div class="beyond-roll-pool-equation ${isAbilityRoll ? "ability-roll" : ""}">

                        ${isAbilityRoll ? `
                            <!-- Ability Base Pool -->

                            <div class="beyond-roll-pool-part beyond-roll-ability">
                                <label>Base Pool</label>

                                <output class="beyond-roll-number">
                                    ${initialAbilityValue}
                                </output>

                                ${showUntrained ? `
                                    <span class="beyond-roll-untrained">Untrained</span>
                                ` : ""}

                                <input type="hidden" name="abilityValue" value="${initialAbilityValue}">
                                <input type="hidden" name="basePool" value="${currentBasePool}">
                            </div>

                            <span class="beyond-roll-operator">+</span>

                            <!-- Attribute Score -->

                            <div class="beyond-roll-pool-part beyond-roll-attribute">
                                <label>Attribute</label>

                                <output class="beyond-roll-number">
                                    ${currentAttributeValue}
                                </output>

                                <input
                                    type="hidden"
                                    name="attributeValue"
                                    value="${currentAttributeValue}"
                                >
                            </div>

                        ` : `

                            <!-- Normal Base Pool -->

                            <div class="beyond-roll-pool-part beyond-roll-base">
                                <label>${foundry.utils.escapeHTML(baseLabel)}</label>

                                <output class="beyond-roll-number">
                                    ${currentBasePool}
                                </output>

                                <input
                                    type="hidden"
                                    name="basePool"
                                    value="${currentBasePool}"
                                >
                            </div>
                        `}

                        <span class="beyond-roll-operator" data-sheet-bonus-sign>
                            ${currentSheetBonus < 0 ? "−" : "+"}
                        </span>

                        <!-- Bonus -->

                        <div class="beyond-roll-pool-part beyond-roll-bonus">
                            <label>${foundry.utils.escapeHTML(isAbilityRoll ? "Ability Bonus" : bonusLabel)}</label>

                            <output class="beyond-roll-number">
                                ${Math.abs(currentSheetBonus)}
                            </output>

                            <input
                                type="hidden"
                                name="sheetBonus"
                                value="${currentSheetBonus}"
                            >
                        </div>

                        <span class="beyond-roll-operator" data-situational-sign>
                            ${initialSituational < 0 ? "−" : "+"}
                        </span>

                        <!-- Situational Modifier -->

                        <div class="beyond-roll-pool-part">
                            <label>Situational</label>

                            <input
                                type="text"
                                class="beyond-situational-input"
                                value="${Math.abs(initialSituational)}"
                                inputmode="numeric"
                                autocomplete="off"
                                aria-label="Situational modifier"
                            >

                            <input
                                type="hidden"
                                name="situational"
                                value="${initialSituational}"
                            >
                        </div>

                        <span class="beyond-roll-operator">=</span>

                        <!-- Total -->

                        <div class="beyond-roll-pool-part beyond-roll-total">
                            <label>Total</label>

                            <output class="beyond-roll-number" data-total-pool>
                                ${initialTotal}
                            </output>
                        </div>

                    </div>


                    <!-- OPTIONAL RESOURCE SPENDS -->

                    <div class="beyond-roll-resource-spends" style="${allowResourceSpending ? "" : "display:none"}">

                        <!-- Spirituality Spent -->

                        <div class="beyond-roll-resource-spend">
                            <label>Spirituality Spent</label>

                            <div class="beyond-roll-resource-stepper">
                                <button
                                    type="button"
                                    data-resource-spend="spiritualitySpent"
                                    data-delta="-1"
                                    disabled
                                >−</button>

                                <output data-resource-value="spiritualitySpent">0</output>

                                <button
                                    type="button"
                                    data-resource-spend="spiritualitySpent"
                                    data-delta="1"
                                    ${spiritualityAvailable === 0 ? "disabled" : ""}
                                >+</button>
                            </div>

                            <input type="hidden" name="spiritualitySpent" value="0">
                            <small>Available: ${spiritualityAvailable}</small>
                        </div>


                        <!-- Determination Declared -->

                        <div class="beyond-roll-resource-spend">
                            <label>Determination Declared</label>

                            <div class="beyond-roll-resource-stepper">
                                <button
                                    type="button"
                                    data-resource-spend="determinationDeclared"
                                    data-delta="-1"
                                    disabled
                                >−</button>

                                <output data-resource-value="determinationDeclared">0</output>

                                <button
                                    type="button"
                                    data-resource-spend="determinationDeclared"
                                    data-delta="1"
                                    ${determinationAvailable === 0 ? "disabled" : ""}
                                >+</button>
                            </div>

                            <input type="hidden" name="determinationDeclared" value="0">
                            <small>Available: ${determinationAvailable}</small>
                        </div>

                    </div>


                    ${hideDifficultyControl ? "" : `
                    <fieldset class="beyond-roll-difficulty">
                        <legend>Difficulty</legend>

                        <div class="beyond-difficulty-options">

                            ${presetDifficulties.map(value => `
                                <label class="beyond-difficulty-option">
                                    <input
                                        type="radio"
                                        name="difficultyChoice"
                                        value="${value}"
                                        ${initialDifficultyChoice === String(value) ? "checked" : ""}
                                        ${allowDifficultyEdit ? "" : "disabled"}
                                    >
                                    <span>${value}</span>
                                </label>
                            `).join("")}


                            <!-- Custom Difficulty -->

                            <div class="beyond-difficulty-option beyond-difficulty-custom">
                                <input
                                    type="radio"
                                    name="difficultyChoice"
                                    value="custom"
                                        ${initialDifficultyChoice === "custom" ? "checked" : ""}
                                    ${allowDifficultyEdit ? "" : "disabled"}
                                >

                                <input
                                    type="number"
                                    name="customDifficulty"
                                    class="beyond-custom-difficulty"
                                    value="${initialCustomDifficulty}"
                                    placeholder="Custom"
                                    min="${minDifficulty}"
                                    max="${maxDifficulty}"
                                    step="1"
                                    aria-label="Custom difficulty"
                                    ${allowDifficultyEdit ? "" : "disabled"}
                                >
                            </div>

                        </div>
                    </fieldset>
                    `}

                </div>
            `,


            /* ============================================
               9. DIALOG INTERACTION
            ============================================ */

            render: (event, dialog) => {
                const root = dialog.element;


                // Custom Difficulty

                const customInput = root.querySelector(".beyond-custom-difficulty");

                const customRadio = root.querySelector(
                    'input[name="difficultyChoice"][value="custom"]'
                );

                const selectCustom = () => {
                    if (!customRadio || !allowDifficultyEdit) return;

                    customRadio.checked = true;

                    root.querySelectorAll(".beyond-difficulty-option").forEach(option => {
                        option.classList.toggle(
                            "selected",
                            option.contains(customRadio)
                        );
                    });
                };

                customInput?.addEventListener("click", selectCustom);
                customInput?.addEventListener("focus", selectCustom);
                customInput?.addEventListener("input", selectCustom);


                // Dice Pool Elements

                const attributeSelect = root.querySelector("#beyond-attribute-select");

                const baseDisplay = root.querySelector(
                    ".beyond-roll-base .beyond-roll-number"
                );

                const bonusDisplay = root.querySelector(
                    ".beyond-roll-bonus .beyond-roll-number"
                );

                const baseHidden = root.querySelector('input[name="basePool"]');

                const attributeDisplay = root.querySelector(
                    ".beyond-roll-attribute .beyond-roll-number"
                );

                const attributeHidden = root.querySelector(
                    'input[name="attributeValue"]'
                );

                const bonusHidden = root.querySelector('input[name="sheetBonus"]');
                const bonusSign = root.querySelector("[data-sheet-bonus-sign]");
                const situationalInput = root.querySelector(".beyond-situational-input");
                const situationalHidden = root.querySelector('input[name="situational"]');
                const situationalSign = root.querySelector("[data-situational-sign]");
                const totalDisplay = root.querySelector("[data-total-pool]");
                const powerModifierOutput = root.querySelector("[data-selected-power-modifier]");
                const powerOptionsContainer = root.querySelector("[data-power-options-list]");
                let selectedPowerModifier = 0;


                // Current resource spending selections.

                const resourceSpendValues = {
                    spiritualitySpent: 0,
                    determinationDeclared: 0
                };

                const resourceSpendLimits = {
                    spiritualitySpent: spiritualityAvailable,
                    determinationDeclared: determinationAvailable
                };


                // Update the total dice pool.

                const updateTotal = () => {
                    if (situationalHidden.value === "") {
                        totalDisplay.textContent = "—";
                        return;
                    }

                    const modifier = Number(situationalHidden.value) || 0;

                    totalDisplay.textContent = calculateTotal(
                        currentBasePool,
                        currentAttributeValue,
                        currentSheetBonus,
                        modifier,
                        resourceSpendValues.spiritualitySpent,
                        selectedPowerModifier
                    );
                };

                const updateSelectedPowerModifier = () => {
                    selectedPowerModifier = [...root.querySelectorAll("[data-power-checkbox]:checked")]
                        .reduce((total, selected) => total + Number(selected.dataset.powerModifier || 0), 0);

                    if (powerModifierOutput) {
                        powerModifierOutput.textContent = `${selectedPowerModifier < 0 ? "−" : "+"}${Math.abs(selectedPowerModifier)}`;
                    }
                };

                const bindPowerCheckboxes = () => {
                    root.querySelectorAll("[data-power-checkbox]").forEach(checkbox => {
                        checkbox.addEventListener("change", () => {
                            const index = checkbox.dataset.powerCheckbox;
                            const hidden = root.querySelector(`input[name="selectedPower_${index}"]`);
                            if (hidden) hidden.value = checkbox.checked ? "1" : "0";
                            updateSelectedPowerModifier();
                            updateTotal();
                        });
                    });
                };

                const refreshPowerOptions = selectedKey => {
                    if (!powerOptionsContainer) return;

                    const selectedIds = new Set(
                        [...root.querySelectorAll("[data-power-checkbox]:checked")]
                            .map(checkbox => powerOptions[Number(checkbox.dataset.powerCheckbox)]?.id)
                            .filter(Boolean)
                    );

                    powerOptions = getPowerOptionsForAttribute(selectedKey);
                    powerOptionsContainer.innerHTML = renderPowerOptionRows(powerOptions);

                    powerOptions.forEach((power, index) => {
                        if (!selectedIds.has(power.id)) return;
                        const checkbox = powerOptionsContainer.querySelector(`[data-power-checkbox="${index}"]`);
                        const hidden = powerOptionsContainer.querySelector(`input[name="selectedPower_${index}"]`);
                        if (checkbox) checkbox.checked = true;
                        if (hidden) hidden.value = "1";
                    });

                    bindPowerCheckboxes();
                    updateSelectedPowerModifier();
                    updateTotal();
                };

                bindPowerCheckboxes();


                /* ============================================
                   RESOURCE SPENDING CONTROLS
                ============================================ */

                root.querySelectorAll("[data-resource-spend]").forEach(button => {
                    button.addEventListener("click", () => {
                        const resource = button.dataset.resourceSpend;
                        const delta = Number(button.dataset.delta);
                        const limit = resourceSpendLimits[resource];

                        if (!Number.isInteger(delta) || !Number.isFinite(limit)) return;

                        resourceSpendValues[resource] = Math.min(
                            limit,
                            Math.max(0, resourceSpendValues[resource] + delta)
                        );

                        const value = resourceSpendValues[resource];

                        const hidden = root.querySelector(
                            `input[name="${resource}"]`
                        );

                        const output = root.querySelector(
                            `[data-resource-value="${resource}"]`
                        );

                        if (hidden) hidden.value = String(value);
                        if (output) output.textContent = String(value);

                        root.querySelectorAll(
                            `[data-resource-spend="${resource}"]`
                        ).forEach(control => {
                            const controlDelta = Number(control.dataset.delta);

                            control.disabled = controlDelta < 0
                                ? value <= 0
                                : value >= limit;
                        });

                        updateTotal();
                    });
                });


                /* ============================================
                   ATTRIBUTE SELECTION
                ============================================ */

                attributeSelect?.addEventListener("change", () => {
                    const selected = attributeOptions.find(
                        option => option.value === attributeSelect.value
                    );

                    if (!selected) return;

                    selectedAttributeOption = selected;
                    refreshPowerOptions(selected.value);
                    const effectsContainer = root.querySelector("[data-roll-effects-container]");
                    if (effectsContainer) effectsContainer.innerHTML = getApplicableRollEffects(selected.value);

                    if (isAbilityRoll) {
                        currentAttributeValue = selected.attributeValue;

                        attributeDisplay.textContent = currentAttributeValue;
                        attributeHidden.value = String(currentAttributeValue);
                    }

                    currentSheetBonus = selected.sheetBonus;

                    if (baseDisplay) {
                        baseDisplay.textContent = currentBasePool;
                    }

                    if (baseHidden) {
                        baseHidden.value = String(currentBasePool);
                    }

                    bonusDisplay.textContent = String(Math.abs(currentSheetBonus));
                    bonusHidden.value = String(currentSheetBonus);
                    bonusSign.textContent = currentSheetBonus < 0 ? "−" : "+";

                    updateTotal();
                });


                /* ============================================
                   SITUATIONAL MODIFIER
                ============================================ */

                let modifierSign = initialSituational < 0 ? -1 : 1;

                situationalInput?.addEventListener("input", () => {
                    const raw = situationalInput.value.trim();

                    // Empty input means zero.

                    if (raw === "") {
                        modifierSign = 1;
                        situationalHidden.value = "0";
                        situationalSign.textContent = "+";

                        updateTotal();

                        situationalInput.setCustomValidity("");
                        return;
                    }

                    // Allow typing a sign before the number.

                    if (raw === "-" || raw === "+") {
                        modifierSign = raw === "-" ? -1 : 1;

                        situationalHidden.value = "";
                        situationalSign.textContent = raw === "-" ? "−" : "+";
                        totalDisplay.textContent = "—";

                        situationalInput.setCustomValidity("Enter a whole number.");
                        return;
                    }

                    // Only accept signed or unsigned whole numbers.

                    if (!/^[+-]?\d+$/.test(raw)) {
                        situationalHidden.value = "";
                        totalDisplay.textContent = "—";

                        situationalInput.setCustomValidity("Enter a whole number.");
                        return;
                    }

                    if (raw.startsWith("-")) modifierSign = -1;
                    else if (raw.startsWith("+")) modifierSign = 1;

                    const magnitude = Math.abs(Number(raw));
                    const signedValue = magnitude * modifierSign;

                    situationalHidden.value = String(signedValue);
                    situationalSign.textContent = signedValue < 0 ? "−" : "+";

                    // The operator displays the sign, so show only the magnitude.
                    situationalInput.value = String(magnitude);

                    updateTotal();
                    situationalInput.setCustomValidity("");
                });

                updateTotal();
                onDialogRender?.(event, dialog);
            },


            /* ============================================
               10. DIALOG BUTTON
            ============================================ */

            ok: {
                label: "Roll Dice"
            }
        });

    } catch (error) {
        console.error("Beyond | Roll dialog failed:", error);
        ui.notifications.error("Could not open the dice roll dialog.");
        return null;
    }


    // Cancelled dialog.

    if (!formData) return null;


    /* ============================================
       11. READ AND VALIDATE FORM DATA
    ============================================ */

    console.log("Beyond | Roll form submitted:", formData);

    const selectedAttributeKey = hasAttributeSelector
        ? String(formData.selectedAttribute ?? selectedAttributeOption.value)
        : null;

    const submittedAttribute = hasAttributeSelector
        ? attributeOptions.find(option => option.value === selectedAttributeKey)
        : null;

    if (hasAttributeSelector && !submittedAttribute) {
        ui.notifications.warn("Please select a valid Attribute.");
        return null;
    }

    const abilityValueValue = isAbilityRoll ? initialAbilityValue : null;

    const attributeValueValue = isAbilityRoll
        ? submittedAttribute.attributeValue
        : null;

    const basePoolValue = isAbilityRoll
        ? abilityValueValue
        : Number(formData.basePool);

    const sheetBonusValue = isAbilityRoll
        ? submittedAttribute.sheetBonus
        : Number(formData.sheetBonus);

    const situationalRaw = String(formData.situational ?? "");
    const situationalValue = Number(situationalRaw);

    const spiritualitySpent = Number(formData.spiritualitySpent ?? 0);
    const determinationDeclared = Number(formData.determinationDeclared ?? 0);

    const selectedPowerModifiers = powerOptions.filter((power, index) =>
        String(formData[`selectedPower_${index}`] ?? "0") === "1"
    );
    const selectedPowerModifier = selectedPowerModifiers.reduce(
        (total, power) => total + power.modifier,
        0
    );

    const difficultyChoice = String(formData.difficultyChoice ?? "");
    const customDifficultyValue = String(formData.customDifficulty ?? "").trim();


    // Situational modifier validation.

    if (situationalRaw === "" || !Number.isInteger(situationalValue)) {
        ui.notifications.warn("Please enter a valid situational modifier.");
        return null;
    }


    // Custom difficulty validation.

    if (!difficultyResolver && difficultyChoice === "custom" && customDifficultyValue === "") {
        ui.notifications.warn("Please enter a custom difficulty.");
        return null;
    }

    let targetDifficulty;
    try {
        targetDifficulty = typeof difficultyResolver === "function"
            ? Number(difficultyResolver(formData))
            : !allowDifficultyEdit
                ? initialDifficulty
                : difficultyChoice === "custom"
                    ? Number(customDifficultyValue)
                    : Number(difficultyChoice);
    } catch (error) {
        console.error("Beyond | Could not resolve roll difficulty:", error);
        targetDifficulty = Number.NaN;
    }


    // Validate all roll and resource values.

    if (
        !Number.isInteger(basePoolValue) ||
        basePoolValue < 0 ||
        basePoolValue > maxPool ||

        (isAbilityRoll && (
            !Number.isInteger(attributeValueValue) ||
            attributeValueValue < 0 ||
            attributeValueValue > maxPool
        )) ||

        !Number.isInteger(sheetBonusValue) ||
        !Number.isInteger(selectedPowerModifier) ||

        !Number.isInteger(spiritualitySpent) ||
        spiritualitySpent < 0 ||
        spiritualitySpent > spiritualityAvailable ||

        !Number.isInteger(determinationDeclared) ||
        determinationDeclared < 0 ||
        determinationDeclared > determinationAvailable ||

        !Number.isInteger(targetDifficulty) ||
        targetDifficulty < minDifficulty ||
        targetDifficulty > maxDifficulty
    ) {
        console.error("Beyond | Invalid roll data:", {
            basePoolValue,
            attributeValueValue,
            sheetBonusValue,
            situationalValue,
            spiritualitySpent,
            determinationDeclared,
            difficultyChoice,
            targetDifficulty,
            selectedAttributeKey
        });

        ui.notifications.warn("Invalid dice pool, resource spend or difficulty.");
        return null;
    }


    /* ============================================
       12. CALCULATE FINAL DICE POOL
    ============================================ */

    const dicePool = calculateTotal(
        basePoolValue,
        isAbilityRoll ? attributeValueValue : 0,
        sheetBonusValue,
        situationalValue,
        spiritualitySpent,
        selectedPowerModifier
    );


    // Re-check resources in case they changed while the dialog was open.

    const currentSpirituality = Math.max(
        0,
        Math.trunc(Number(actor?.system?.pathway?.spirituality?.value) || 0)
    );

    const currentDetermination = Math.max(
        0,
        Math.min(
            Math.trunc(Number(actor?.system?.determination?.determination?.temp) || 0),
            getAvailableDeterminationMaximum(actor)
        )
    );

    if (
        spiritualitySpent > currentSpirituality ||
        determinationDeclared > currentDetermination
    ) {
        ui.notifications.warn(
            "One or more resources changed while the roll dialog was open. Please roll again."
        );
        return null;
    }


    /* ============================================
       13. ROLL AND CREATE CHAT MESSAGE
    ============================================ */

    try {
        const roll = new Roll(
            dicePool > 0 ? `${dicePool}d10` : "0"
        );

        await roll.evaluate();


        // Calculate rolled successes and add declared Determination successes.

        const result = evaluateSuccesses(roll, targetDifficulty);

        const totalSuccesses = result.successes + determinationDeclared;

        const formatModifier = value =>
            `${value < 0 ? "−" : "+"}${Math.abs(value)}`;


        const selectedAttributeLabel = submittedAttribute?.label ?? null;
        const stabilityPoolPenalty = getStabilityPoolPenalty(
            actor,
            isAbilityRoll ? selectedAttributeKey : attributeKey
        );
        const sequenceStabilityPoolPenalty = isSequenceRoll
            ? getSequenceStabilityPoolPenalty(actor)
            : 0;

        const displayBonusLabel = foundry.utils.escapeHTML(
            isAbilityRoll ? "Ability Bonus" : bonusLabel
        );

        const displayAttribute = selectedAttributeLabel
            ? foundry.utils.escapeHTML(selectedAttributeLabel)
            : null;


        /* ============================================
           CHAT POOL BREAKDOWN
        ============================================ */

        // Base Pool is displayed on its own row.
        // Ability rolls show the selected Attribute score separately.
        // Spirituality adds dice; Determination adds successes, not dice.

        const poolBreakdown = `
            <div class="beyond-roll-breakdown-base">
                <div class="beyond-roll-stat">
                    <span>Base Pool</span>
                    <strong>${basePoolValue}</strong>
                </div>
            </div>

            <div class="beyond-roll-breakdown-modifiers ${isAbilityRoll ? "ability-roll-modifiers" : ""}">

                ${isAbilityRoll ? `
                    <div class="beyond-roll-stat">
                        <span>${displayAttribute} Score</span>
                        <strong>${attributeValueValue}</strong>
                    </div>

                    <div class="beyond-roll-stat">
                        <span>Ability Bonus</span>
                        <strong>${formatModifier(sheetBonusValue)}</strong>
                    </div>
                ` : `
                    <div class="beyond-roll-stat">
                        <span>${displayBonusLabel}</span>
                        <strong>${formatModifier(sheetBonusValue)}</strong>
                    </div>
                `}

                ${stabilityPoolPenalty ? `
                    <div class="beyond-roll-stat">
                        <span>Stability</span>
                        <strong>${formatModifier(stabilityPoolPenalty)}d</strong>
                    </div>
                ` : ""}

                ${sequenceStabilityPoolPenalty ? `
                    <div class="beyond-roll-stat">
                        <span>Stability (Sequence)</span>
                        <strong>${formatModifier(sequenceStabilityPoolPenalty)}d</strong>
                    </div>
                ` : ""}

                ${rollDifficultyPenalty ? `
                    <div class="beyond-roll-stat">
                        <span>${isSequenceRoll ? "Transgressions" : "Transgressions (Loss of Control)"}</span>
                        <strong>+${rollDifficultyPenalty} difficulty</strong>
                    </div>
                ` : ""}

                <div class="beyond-roll-stat">
                    <span>Spirituality Spent</span>
                    <strong>+${spiritualitySpent}d</strong>
                </div>

                <div class="beyond-roll-stat">
                    <span>Situational</span>
                    <strong>${formatModifier(situationalValue)}</strong>
                </div>

            </div>

            ${selectedPowerModifiers.length ? `
                <div class="beyond-roll-breakdown-powers">
                    ${selectedPowerModifiers.map(power => `
                        <div class="beyond-roll-stat">
                            <span>${foundry.utils.escapeHTML(power.name)}${power.sourceDescription ? ` <small>(${foundry.utils.escapeHTML(power.sourceDescription)})</small>` : ""}</span>
                            <strong>${formatModifier(power.modifier)}</strong>
                        </div>
                    `).join("")}
                </div>
            ` : ""}

            <div class="beyond-roll-breakdown-total">
                <div class="beyond-roll-stat total">
                    <span>Total Pool</span>
                    <strong>${dicePool}d10</strong>
                </div>
            </div>
        `;


        /* ============================================
           CHAT MESSAGE
        ============================================ */

        const messageData = {
            flavor: `
                <div class="beyond-roll-card">

                    <div class="beyond-roll-header">
                        <h2>${foundry.utils.escapeHTML(label)}</h2>

                        <span class="beyond-roll-difficulty-label">
                            DIFFICULTY ${targetDifficulty}
                        </span>
                    </div>

                    <div class="beyond-roll-pool-breakdown">
                        ${poolBreakdown}
                    </div>

                    <div class="beyond-roll-successes">
                        <span>SUCCESSFUL ROLLS</span>
                        <strong>${totalSuccesses}</strong>
                        <span>Successes</span>
                    </div>

                    <div class="beyond-roll-details">

                        <div>
                            <span>Regular Successes</span>
                            <strong>${result.regularSuccesses}</strong>
                        </div>

                        <div>
                            <span>Extra Successes from 10s</span>
                            <strong>+${result.tens}</strong>
                        </div>

                        <div>
                            <span>Cancelled by 1s</span>
                            <strong>−${result.cancelledSuccesses}</strong>
                        </div>

                        <div>
                            <span>Determination Declared</span>
                            <strong>+${determinationDeclared} success${determinationDeclared === 1 ? "" : "es"}</strong>
                        </div>

                    </div>

                </div>
            `
        };

        if (actor) {
            messageData.speaker = ChatMessage.getSpeaker({actor});
        }


        /* ============================================
           POST ROLL TO CHAT
        ============================================ */

        console.log("Beyond | Creating roll chat message");

        await roll.toMessage(messageData);

        console.log("Beyond | Roll message created successfully");


        /* ============================================
           14. SPEND RESOURCES AFTER POSTING
        ============================================ */

        if (actor && (spiritualitySpent > 0 || determinationDeclared > 0)) {
            // Read the latest values again to avoid overwriting a change
            // made while the roll was being posted.
            const latestSpirituality = Math.max(
                0,
                Math.trunc(Number(actor.system.pathway?.spirituality?.value) || 0)
            );

            const latestDetermination = Math.max(
                0,
                Math.trunc(Number(actor.system.determination?.determination?.temp) || 0)
            );

            if (
                spiritualitySpent > latestSpirituality ||
                determinationDeclared > latestDetermination
            ) {
                console.error("Beyond | Roll posted, but resources changed before spending.");
                ui.notifications.warn(
                    "The roll was posted, but the selected resources could not be deducted because their values changed."
                );
            } else {
                const resourceUpdate = {};

                if (spiritualitySpent > 0) {
                    resourceUpdate["system.pathway.spirituality.value"] =
                        latestSpirituality - spiritualitySpent;
                }

                if (determinationDeclared > 0) {
                    resourceUpdate["system.determination.determination.temp"] =
                        latestDetermination - determinationDeclared;
                }

                try {
                    await actor.update(resourceUpdate);
                } catch (resourceError) {
                    console.error(
                        "Beyond | Roll posted, but resource spending could not be saved:",
                        resourceError
                    );

                    ui.notifications.warn(
                        "The roll was posted, but resource spending could not be saved."
                    );
                }
            }
        }


        /* ============================================
           15. RETURN RESULTS
        ============================================ */

        return {
            roll,
            basePool: basePoolValue,
            ability: abilityValueValue,
            attribute: attributeValueValue,
            selectedAttribute: selectedAttributeKey,
            sheetBonus: sheetBonusValue,
            situational: situationalValue,
            spiritualitySpent,
            determinationDeclared,
            pool: dicePool,
            difficulty: targetDifficulty,
            stabilityPoolPenalty,
            sequenceStabilityPoolPenalty,
            rollDifficultyPenalty,
            untrained: showUntrained,
            ...result,
            successes: totalSuccesses
        };

    } catch (error) {
        console.error("Beyond | Dice rolling failed:", error);

        ui.notifications.error(
            "Dice roll failed. Check the browser console for details."
        );

        return null;
    }
}
