// Command demos registry

import animate from "./animate.js";
import bolder from "./bolder.js";
import normalize from "./normalize.js";
import audit from "./audit.js";
import polish from "./polish.js";
import optimize from "./optimize.js";
import harden from "./harden.js";
import clarify from "./clarify.js";
import quieter from "./quieter.js";
import simplify from "./simplify.js";
import colorize from "./colorize.js";
import delight from "./delight.js";
import extract from "./extract.js";
import adapt from "./adapt.js";
import onboard from "./onboard.js";

export const commandDemos = {
	normalize,
	bolder,
	animate,
	audit,
	polish,
	optimize,
	harden,
	clarify,
	quieter,
	simplify,
	colorize,
	delight,
	extract,
	adapt,
	onboard,
};

export function getCommandDemo(commandId) {
	return commandDemos[commandId] || null;
}


