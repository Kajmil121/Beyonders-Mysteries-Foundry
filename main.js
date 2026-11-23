import {BeyonderData} from "./modules/actor/beyonder.js";
import {AntagonistData} from "./modules/actor/antagonist.js";
import {BeyonderSheet} from "./modules/actor/beyonderSheet.js";
import {PathwayItemData} from "./modules/models/pathwayItem.js";
import {PathwayItemSheet} from "./modules/item/pathwayItemSheet.js";
import {BeyonderPowerData} from "./modules/models/beyonderPower.js";
import {BeyonderPowerSheet} from "./modules/item/beyonderPowerSheet.js";

console.log("Beyond | main.js loaded");

Hooks.once("init", () => {
    console.log("Beyond | Initializing system");

    CONFIG.Actor.dataModels = {
        ...CONFIG.Actor.dataModels,
        Beyonder: BeyonderData,
        Antagonist: AntagonistData
    };
    CONFIG.Item.dataModels = {
        ...CONFIG.Item.dataModels,
        Pathway: PathwayItemData,
        BeyonderPower: BeyonderPowerData
    };

    foundry.applications.apps.DocumentSheetConfig.registerSheet(
        foundry.documents.Actor,
        game.system.id,
        BeyonderSheet,
        {
            types: ["Beyonder"],
            makeDefault: true
        }
    );
    foundry.applications.apps.DocumentSheetConfig.registerSheet(
        foundry.documents.Item,
        game.system.id,
        PathwayItemSheet,
        {
            types: ["Pathway"],
            makeDefault: true
        }
    );

    foundry.applications.apps.DocumentSheetConfig.registerSheet(
        foundry.documents.Item,
        game.system.id,
        BeyonderPowerSheet,
        {
            types: ["BeyonderPower"],
            makeDefault: true
        }
    );

    console.log("Beyond | BeyonderSheet registered", BeyonderSheet);
    console.log("Beyond | BeyonderPowerSheet registered", BeyonderPowerSheet);
});