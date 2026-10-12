import { redirect } from '@sveltejs/kit';

export const load = async ({ request, locals }) => {
	const session = await locals.auth.api.getSession(request);
	if (!session) {
		throw redirect(302, '/');
	}

	return {
		user: session.user,
		cloudflareGeolocationData: await locals.auth.api.getGeolocation({
			headers: request.headers
		})
	};
};
