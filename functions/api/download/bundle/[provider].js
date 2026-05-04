import { BUNDLE_DOWNLOAD_PROVIDERS } from "../../../../cli/lib/download-providers.js";

export async function onRequestGet(context) {
	const { provider } = context.params;

	if (!provider || !BUNDLE_DOWNLOAD_PROVIDERS.includes(provider)) {
		return Response.json({ error: "Invalid provider" }, { status: 400 });
	}

	const url = new URL(context.request.url);
	url.pathname = `/_data/dist/${provider}.zip`;

	const response = await context.env.ASSETS.fetch(url);

	if (!response.ok) {
		return Response.json({ error: "Bundle not found" }, { status: 404 });
	}

	const content = await response.arrayBuffer();
	const safeProvider = provider.replace(/[^a-zA-Z0-9._-]/g, '');

	return new Response(content, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="impeccable-style-${safeProvider}.zip"`,
			'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
		}
	});
}
