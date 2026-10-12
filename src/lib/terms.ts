/** Terms-of-use acceptance flag. Lives outside the dialog so stores can read it without importing UI. */
export const TERMS_ACCEPTED_KEY = 'plebeian_terms_accepted'

export function hasAcceptedTerms(): boolean {
	return localStorage.getItem(TERMS_ACCEPTED_KEY) === 'true'
}
