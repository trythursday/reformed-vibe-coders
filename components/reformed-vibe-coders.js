import { html, r } from "https://esm.sh/jsr/@campfire/core@4.0.4";

const PRESETS = {
  "10M": 10_000_000,
  "100M": 100_000_000,
  "500M": 500_000_000,
  "1B": 1_000_000_000,
};

const STYLES = `
  reformed-vibe-coders { display: block; width: 100%; margin-block: 2em; }
  reformed-vibe-coders .pledge { max-width: 40ch; margin-inline: auto; }
  reformed-vibe-coders .budget-row { display: flex; flex-wrap: wrap; gap: 0.5rem 2rem; }
  reformed-vibe-coders .budget-row label { margin-block-start: 0; }
  reformed-vibe-coders [hidden] { display: none; }
  reformed-vibe-coders .error:empty { display: none; }
  reformed-vibe-coders form > label + input,
  reformed-vibe-coders form > label + textarea { margin-block-start: 0.5rem; }
  reformed-vibe-coders form > label:not(:first-child) { margin-block-start: 2rem; }
  reformed-vibe-coders form button {
    display: block;
    margin-block-start: 3rem;
    margin-inline-start: auto;
  }
`;

class ReformedVibeCoders extends HTMLElement {
  #form;
  #error;
  #customWrap;

  connectedCallback() {
    if (this.#form) return;

    const uid = Math.random().toString(36).slice(2, 8);
    const id = (name) => `rvc-${uid}-${name}`;

    if (!this.getAttribute("repo")) {
      this.textContent = "reformed-vibe-coders: missing repo attribute";
      return;
    }

    this.innerHTML = html`
      <style>${r(STYLES)}</style>
      <div class="pledge">
        <form novalidate>
        <fieldset>
          <legend>Monthly Token Pledge</legend>
          <div class="budget-row">
            ${r(
              Object.keys(PRESETS)
                .map(
                  (preset) => html`
                    <label>
                      <input
                        type="radio"
                        name="budget"
                        value="${preset}"
                        ${preset === "100M" ? r("checked") : ""}
                      />
                      ${preset}
                    </label>
                  `,
                )
                .join(""),
            )}
            <label>
              <input type="radio" name="budget" value="custom" />
              Custom
            </label>
          </div>

          <div class="custom" hidden>
            <label for="${id("custom")}">
              Custom budget <small>in billions of tokens</small>
            </label>
            <input
              id="${id("custom")}"
              name="custom"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              placeholder="2"
            />
          </div>
        </fieldset>

        <label for="${id("things")}">
          Things I would like to build
          <small>optional · markdown is fine</small>
        </label>
        <textarea id="${id("things")}" name="things" rows="6"></textarea>

        <label for="${id("website")}">
          Website, LinkedIn, or Twitter
          <small>optional</small>
        </label>
        <input
          id="${id("website")}"
          name="website"
          type="text"
          inputmode="url"
          spellcheck="false"
          placeholder="https://example.com"
        />

        <p id="${id("error")}" class="error" role="alert"></p>

        <button type="submit">Pledge on GitHub</button>
        </form>
      </div>
    `;

    this.#form = this.querySelector("form");
    this.#error = this.querySelector(`#${id("error")}`);
    this.#customWrap = this.querySelector(".custom");

    this.#form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#submit();
    });

    this.#form.addEventListener("change", (event) => {
      if (event.target.name !== "budget") return;

      const custom = event.target.value === "custom";

      this.#customWrap.hidden = !custom;
      this.#customWrap.querySelector("input").required = custom;
    });

    this.#form.addEventListener("input", (event) => {
      event.target.removeAttribute("aria-invalid");
      this.#say("");
    });
  }

  async #submit() {
    const form = new FormData(this.#form);
    const things = String(form.get("things") ?? "").trim();
    const website = String(form.get("website") ?? "").trim();
    const picked = form.get("budget");

    const fail = (field, message) => {
      field?.setAttribute("aria-invalid", "");
      field?.focus();
      this.#say(message, true);
    };

    let tokens;
    if (picked === "custom") {
      const billions = Number(this.#form.elements.custom.value);

      if (!Number.isInteger(billions) || billions < 1) {
        return fail(
          this.#form.elements.custom,
          "Custom budget must be a whole number of billions, 1 or more.",
        );
      }
      tokens = billions * 1_000_000_000;
    } else {
      tokens = PRESETS[picked];
    }

    if (!tokens) return fail(null, "Pick a token budget.");

    if (website && !this.#isLink(website)) {
      return fail(this.#form.elements.website, "That must be an http(s) link.");
    }

    const button = this.#form.querySelector("button");
    button.disabled = true;
    this.#say("Creating your pledge…");

    try {
      const response = await fetch(
        this.getAttribute("endpoint") ?? "/api/pledge",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: this.getAttribute("repo"),
            tokens,
            things: things || null,
            website: website || null,
          }),
        },
      );

      const reply = await response.json().catch(() => null);

      if (reply?.redirect) {
        location.assign(reply.redirect);
        return;
      }

      if (!response.ok || !reply?.url) {
        throw new Error(
          reply?.error ?? "The pledge service did not accept this pledge.",
        );
      }

      this.innerHTML = html`
        <style>${r(STYLES)}</style>
        <div class="pledge">
          <p role="status">
            Pledge created:
            <a href="${reply.url}"
              >${reply.url.replace("https://github.com/", "")}</a
            >
          </p>
        </div>
      `;
    } catch (error) {
      button.disabled = false;
      this.#say(
        error instanceof Error ? error.message : "Something went wrong.",
        true,
      );
    }
  }

  #say(message, isError = false) {
    this.#error.className = isError ? "error" : "";
    this.#error.textContent = message;
  }

  #isLink(value) {
    try {
      return /^https?:$/.test(new URL(value).protocol);
    } catch {
      return false;
    }
  }
}

customElements.define("reformed-vibe-coders", ReformedVibeCoders);
