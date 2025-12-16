// Skill demos registry

import colorAndContrast from "./color-and-contrast.js";
import interactionDesign from "./interaction-design.js";
import motionDesign from "./motion-design.js";
import responsiveDesign from "./responsive-design.js";
import spatialDesign from "./spatial-design.js";
import typography from "./typography.js";
import uxWriting from "./ux-writing.js";

export const skillDemos = {
	"ux-writing": uxWriting,
	"spatial-design": spatialDesign,
	"motion-design": motionDesign,
	typography: typography,
	"interaction-design": interactionDesign,
	"color-and-contrast": colorAndContrast,
	"responsive-design": responsiveDesign,
};

export function getSkillDemo(skillId) {
	return skillDemos[skillId] || null;
}


