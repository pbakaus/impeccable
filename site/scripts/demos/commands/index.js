// Command demos registry

import animate from "./animate.js";
import bolder from "./bolder.js";
import audit from "./audit.js";
import critique from "./critique.js";
import polish from "./polish.js";
import optimize from "./optimize.js";
import harden from "./harden.js";
import clarify from "./clarify.js";
import quieter from "./quieter.js";
import distill from "./distill.js";
import colorize from "./colorize.js";
import delight from "./delight.js";
import adapt from "./adapt.js";
import typeset from "./typeset.js";
import layout from "./layout.js";
import overdrive from "./overdrive.js";

export const commandDemos = {
	bolder,
	animate,
	audit,
	critique,
	polish,
	optimize,
	harden,
	clarify,
	quieter,
	distill,
	colorize,
	delight,
	adapt,
	typeset,
	layout,
	overdrive,
};

export function getCommandDemo(commandId) {
	return commandDemos[commandId] || null;
}
