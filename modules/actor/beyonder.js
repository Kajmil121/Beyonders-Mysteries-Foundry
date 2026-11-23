import {BaseActor} from "./baseActor.js";
import {BackgroundsDM} from "../models/baseFeatures.js";

export class BeyonderData extends BaseActor {
    static defineSchema() {
        return {
            ...super.defineSchema(),
            backgrounds: new foundry.data.fields.EmbeddedDataField(BackgroundsDM)
        };
    }
}