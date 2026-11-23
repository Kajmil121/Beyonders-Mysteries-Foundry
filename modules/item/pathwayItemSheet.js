
import {getSequenceTier} from "../models/pathwayItem.js";

const {HandlebarsApplicationMixin} = foundry.applications.api;
const {ItemSheetV2} = foundry.applications.sheets;

export class PathwayItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

    /* ==========================================
       DEFAULT OPTIONS
    ========================================== */

    static DEFAULT_OPTIONS = {
        ...super.DEFAULT_OPTIONS,
        classes: ["beyond", "pathway-item"],
        position: {width: 1000, height: 850},
        editPermission: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        window: {
            ...super.DEFAULT_OPTIONS.window,
            title: "",
            resizable: true,
            minimizable: true
        },
        form: {
            ...super.DEFAULT_OPTIONS.form,
            submitOnChange: false,
            closeOnSubmit: false
        }
    };


    /* ==========================================
       TEMPLATE
    ========================================== */

    static PARTS = {
        form: {
            template: "systems/Beyond/templates/item/pathway-item-sheet.hbs"
        }
    };


    /* ==========================================
       TITLE AND EDIT PERMISSIONS
    ========================================== */

    get title() {
        return this.item.name;
    }

    /**
     * The GM can edit the Pathway Item only when:
     * - The user is a GM.
     * - The individual Item is unlocked.
     * - The containing compendium is unlocked, if applicable.
     */
    get canEditPathway() {
        if (!game.user.isGM || this.item.system.locked !== false) {
            return false;
        }

        const pack = this.item.pack
            ? game.packs.get(this.item.pack)
            : null;

        return !pack || !pack.locked;
    }


    /* ==========================================
       PREPARE CONTEXT
    ========================================== */

    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        const itemData = this.item.system.toObject();

        context.item = this.item;
        context.isGM = game.user.isGM;
        context.locked = this.item.system.locked !== false;
        context.editable = this.canEditPathway;

        // Pathway Profiles.
        context.profiles = [
            {value: "mystic", label: "Mystic"},
            {value: "mixed", label: "Mixed"},
            {value: "corporeal", label: "Corporeal"}
        ].map(profile => ({
            ...profile,
            selected: profile.value === itemData.profile
        }));

        // Sequence information and automatically calculated tiers.
        context.sequences = (itemData.sequences ?? []).map((sequence, index) => ({
            ...sequence,
            index,
            tier: getSequenceTier(sequence.number),
            expanded: this._expandedSequences
                ? this._expandedSequences.has(index)
                : index === 0
        }));

        return context;
    }


    /* ==========================================
       PRESERVE EXPANDED SEQUENCES
    ========================================== */

    /**
     * Records which sequence sections are currently expanded.
     *
     * This prevents Item updates from resetting the sheet
     * to Sequence 9 every time something changes.
     */
    _captureExpandedSequences() {
        const sequences = [
            ...this.element.querySelectorAll(".pathway-sequence")
        ];

        this._expandedSequences = new Set(
            sequences
                .map((sequence, index) => {
                    const sequenceIndex = Number(sequence.dataset.sequenceIndex);

                    return sequence.open
                        ? Number.isInteger(sequenceIndex) ? sequenceIndex : index
                        : -1;
                })
                .filter(index => index !== -1)
        );
    }

    _captureSheetState() {
    const scrollContainer = this.element.querySelector(".pathway-item-sheet");

    if (scrollContainer) {
        this._scrollPosition = scrollContainer.scrollTop;
    }

    this._captureExpandedSequences();
}


    /* ==========================================
       RENDER AND EVENT LISTENERS
    ========================================== */

    async _onRender(context, options) {
        await super._onRender(context, options);

        // Individual Item Lock.
        this.element.querySelector("[data-action='toggle-lock']")
            ?.addEventListener("click", event => this._onToggleLock(event));

        // Pathway Image Picker.
        this.element.querySelector("[data-action='pick-image']")
            ?.addEventListener("click", event => this._onPickImage(event));

        // All editable fields.
        this.element.querySelectorAll("[data-pathway-field]").forEach(field => {
            field.addEventListener("change", event => this._onFieldChange(event));
        });

        // Prevent accidental form submission.
        this.form?.addEventListener("submit", event => event.preventDefault());

        // Restore previous scrollbar position after rendering.
        const scrollPosition = this._scrollPosition ?? 0;

        requestAnimationFrame(() => {
            const scrollContainer = this.element.querySelector(".pathway-item-sheet");

            if (scrollContainer) {
                scrollContainer.scrollTop = scrollPosition;
            }
        });
    }


    /* ==========================================
       PATHWAY IMAGE PICKER
    ========================================== */

    async _onPickImage(event) {
        event.preventDefault();

        if (!this.canEditPathway) return;

        const FilePicker = foundry.applications.apps.FilePicker;

        const picker = new FilePicker({
            type: "image",
            current: this.item.img,

            callback: async path => {
                if (!path || !this.canEditPathway) return;

                this._captureSheetState();

                try {
                    await this.item.update({
                        img: path
                    });
                } catch (error) {
                    console.error("Beyond | Could not update Pathway image", error);
                    ui.notifications.error("Could not update Pathway image.");
                }
            }
        });

        await picker.render({force: true});
    }


    /* ==========================================
       INDIVIDUAL ITEM LOCK
    ========================================== */

    async _onToggleLock(event) {
        event.preventDefault();

        if (!game.user.isGM) return;

        this._captureSheetState();

        // Check whether the containing compendium is locked.
        const pack = this.item.pack
            ? game.packs.get(this.item.pack)
            : null;

        if (pack?.locked) {
            ui.notifications.warn(
                "Unlock the Pathways compendium before editing its Items."
            );
            return;
        }

        try {
            const nextLocked = this.item.system.locked !== false;

            await this.item.update({
                "system.locked": !nextLocked
            });

        } catch (error) {
            console.error("Beyond | Could not toggle Pathway lock", error);
            ui.notifications.error("Could not update Pathway lock.");
        }
    }


    /* ==========================================
       FIELD CHANGE HANDLER
    ========================================== */

    async _onFieldChange(event) {
        if (!this.canEditPathway) return;

        this._captureSheetState();

        const field = event.currentTarget;
        const fieldType = field.dataset.pathwayField;

        let value = field.value;

        // Validate sequence-specific advancement values.
        if (fieldType === "sequence") {
            const property = field.dataset.sequenceProperty;

            if (!property) return;

            // Ceiling can be left blank to indicate no override.
            if (property.endsWith(".ceiling")) {
                value = value.trim() === "" ? null : Number(value);

                if (
                    value !== null &&
                    (!Number.isInteger(value) || value < 1 || value > 10)
                ) {
                    ui.notifications.warn(
                        "Attribute ceilings must be between 1 and 10."
                    );
                    return;
                }
            }

            // Levels must be whole numbers between 0 and 10.
            else if (property.endsWith(".levels")) {
                value = Number(value);

                if (!Number.isInteger(value) || value < 0 || value > 10) {
                    ui.notifications.warn(
                        "Attribute advancements must be between 0 and 10."
                    );
                    return;
                }
            }

            // Sequence names remain strings.
        }

        try {

            // Pathway Name.
            if (fieldType === "name") {
                await this.item.update({
                    name: value
                });

                return;
            }

            // Pathway Profile.
            if (fieldType === "profile") {
                await this.item.update({
                    "system.profile": value
                });

                return;
            }

            // Pathway Authorities.
            if (fieldType === "authorities") {
                await this.item.update({
                    "system.authorities": value
                });

                return;
            }

            // Sequence-specific information.
            if (fieldType === "sequence") {
                const index = Number(field.dataset.sequenceIndex);
                const property = field.dataset.sequenceProperty;

                const sequences = foundry.utils.deepClone(
                    this.item.system.toObject().sequences ?? []
                );

                if (
                    !Number.isInteger(index) ||
                    index < 0 ||
                    !sequences[index] ||
                    !property
                ) {
                    return;
                }

                // Update the requested sequence property.
                foundry.utils.setProperty(
                    sequences[index],
                    property,
                    value
                );

                // Save the updated sequence array.
                await this.item.update({
                    "system.sequences": sequences
                });
            }

        } catch (error) {
            console.error("Beyond | Could not update Pathway Item", error);
            ui.notifications.error("Could not save Pathway Item changes.");
        }
    }
}
