import { Resolver } from "./generated.js";
import { UsageError } from "./git.js";

/** Resolves a commit's author to a GitHub account (spec §15.3). Results are cached per run. */
export function githubResolver(token: string, repository: string, fetchImpl: typeof fetch = fetch): Resolver {
  const cache = new Map<string, { login: string; type: string } | null>();
  return async (sha) => {
    if (cache.has(sha)) return cache.get(sha)!;
    const res = await fetchImpl(`https://api.github.com/repos/${repository}/commits/${sha}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "okf-maintain",
      },
    });
    let result: { login: string; type: string } | null = null;
    if (res.ok) {
      const body = (await res.json()) as { author?: { login: string; type: string } | null };
      if (body.author) result = { login: body.author.login, type: body.author.type };
    } else if (res.status !== 404 && res.status !== 422) {
      throw new UsageError(`GitHub API returned ${res.status} resolving the author of ${sha}`);
    }
    cache.set(sha, result);
    return result;
  };
}
