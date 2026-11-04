/**
 * Stream polish, Host half.
 *
 * Pure UI plugin: the empty apply exists so the bundle appears in the host
 * Loader; the browser half ships through exports["./client"] and the
 * package.json `dsh.client` declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply() {}
