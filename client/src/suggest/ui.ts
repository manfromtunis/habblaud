import type { Idea } from "./types";
import { parseVoteToken, isTokenExpired, extractHashToken, getStoredToken, saveStoredToken, removeStoredToken, signinUrl as signinLink } from "./token";
import { findSimilarIdeas } from "./similar";
import { selectLatestIdeas, formatRelativeTime, mergePolledIdeas } from "./feed";
import { createSyntheticAgent } from "./synthetic";
import { loadOwnIdeaIds, saveOwnIdeaId, loadHeldIdeas, saveHeldIdea, pruneHeldIdeas, loadVotedIdeaIds, setVotedIdeaId } from "./storage";
import { fetchIdeas, postIdea, postVote } from "./client";
import type { PublicFeed, PublicAgent } from "../../../shared/demo/public";
import "./suggest.css";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function formatStatus(status: string): string {
  const clean = status.replace(/[-_]+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function statusChipClass(status: string): string {
  const norm = status.toLowerCase().replace(/\s+/g, "-");
  return `idea-chip chip-${norm}`;
}

export interface SuggestManagerOptions {
  container: HTMLElement;
  onSyntheticAgentUpdate: (agent: PublicAgent | null) => void;
  onFocusAgent: (agentId: string) => void;
}

/** The product's sign-in link, coming back to this page; null unless voteUrl is https. */
function signinUrl(voteUrl: unknown): string | null {
  return signinLink(voteUrl, window.location.origin + window.location.pathname);
}

const DRAFT_KEY = "suggest-draft";

/** Code points, as the service counts them (UTF-16 length counts an emoji as 2). */
function charCount(text: string): number {
  return [...text].length;
}

/** Drops control and format characters the service refuses, keeping newlines, tabs and emoji joiners. */
function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => ("\n\t\u200c\u200d".includes(c) ? c : ""))
    .trim();
}

/** A vote count the visitor just changed wins over polled counts for this long (ideas.json may be cached 30 s). */
const VOTE_HOLD_MS = 60_000;
/** Notice key shown on every product tab. */
const ANY_PRODUCT = "*";

export class SuggestManager {
  private container: HTMLElement;
  private onSyntheticAgentUpdate: (agent: PublicAgent | null) => void;
  private onFocusAgent: (agentId: string) => void;

  private currentFeed: PublicFeed = { builtAt: "", products: {}, agents: [] };
  private allIdeas: Idea[] = [];
  private ownIdeaIds = loadOwnIdeaIds();
  private heldIdeas = loadHeldIdeas();
  private votedIdeaIds = loadVotedIdeaIds();

  private activeProductTab = "";
  private selectedSuggestProduct = "";
  private activeSyntheticAgent: PublicAgent | null = null;
  private syntheticTimer6: ReturnType<typeof setTimeout> | null = null;
  private syntheticTimer60: ReturnType<typeof setTimeout> | null = null;

  // DOM elements
  private btnRow = el("div", "pixel-btn-row");
  private btnBoard = el("button", "pixel-suggest-btn pixel-ideas-btn", "Ideas board");
  private btnSuggest = el("button", "pixel-suggest-btn", "Suggest a feature");

  private suggestBackdrop = el("div", "pixel-dialog-backdrop");
  private suggestDialog = el("div", "pixel-dialog");
  private suggestProductContainer = el("div", "pixel-products");
  private suggestTextarea = el("textarea", "pixel-textarea");
  private suggestCharCounter = el("div", "pixel-char-counter", "0 / 500");
  private suggestEmail = el("input", "pixel-input");
  private suggestHoneypot = el("input");
  private suggestError = el("div", "pixel-error-msg");
  private suggestSendBtn = el("button", "pixel-btn pixel-btn-send", "Send");
  private similarBox = el("div", "similar-box");
  private similarList = el("ul", "similar-list");

  private boardBackdrop = el("div", "pixel-dialog-backdrop");
  private boardDialog = el("div", "pixel-dialog ideas-panel");
  private boardTabsContainer = el("div", "ideas-tabs");
  private boardAuthBar = el("div", "ideas-auth-bar");
  private boardList = el("ul", "ideas-list");

  private feedCard = el("aside", "feed-card");
  private feedList = el("ul", "feed-list");

  private workCard = el("div", "pixel-work-card");
  private workCardProductPill = el("span", "card-product-pill");
  private workCardBody = el("div", "pixel-work-card-body");

  private lastIdeasPoll = 0;
  /** Time of the last POST that changed ideas or votes: a poll that started before it is stale. */
  private lastWriteAt = 0;
  /** Own public ideas from POST replies, kept until ideas.json lists them. */
  private recentOwn: Idea[] = [];
  private sending = false;
  /** Sign-in and vote notices, per product key (ANY_PRODUCT: every tab). */
  private notices = new Map<string, string>();
  private voteHolds = new Map<string, { votes: number; at: number }>();

  constructor(options: SuggestManagerOptions) {
    this.container = options.container;
    this.onSyntheticAgentUpdate = options.onSyntheticAgentUpdate;
    this.onFocusAgent = options.onFocusAgent;

    this.initTokenFromUrl();
    this.buildDom();
    this.setupListeners();
    this.restoreDraft();
    window.addEventListener("hashchange", () => {
      this.initTokenFromUrl();
      this.renderBoardAuthBar();
      this.renderBoardList();
      this.renderSimilarInForm();
    });
    void this.pollIdeas();

    // Poll ideas every 60s and on focus
    setInterval(() => void this.pollIdeas(), 60_000);
    window.addEventListener("focus", () => {
      if (Date.now() - this.lastIdeasPoll > 30_000) {
        void this.pollIdeas();
      }
    });
  }

  public getSyntheticAgent(): PublicAgent | null {
    return this.activeSyntheticAgent;
  }

  public updateFeed(feed: PublicFeed): void {
    this.currentFeed = feed;
    const productKeys = Object.keys(feed.products);
    if (!productKeys.includes(this.activeProductTab) && productKeys.length > 0) {
      this.activeProductTab = productKeys[0];
    }
    if (!productKeys.includes(this.selectedSuggestProduct) && productKeys.length > 0) {
      this.selectedSuggestProduct = productKeys[0];
    }

    this.renderSuggestProducts();
    this.renderBoardTabs();
    this.renderBoardAuthBar();
    this.renderBoardList();
    this.renderFeedCard();
  }

  private initTokenFromUrl(): void {
    const hash = window.location.hash;
    if (!hash.includes("suggest-token=")) return;
    try {
      const token = extractHashToken(hash);
      const payload = token ? parseVoteToken(token) : null;
      if (token && payload && !isTokenExpired(payload)) {
        saveStoredToken(payload.product, token);
        this.notices.delete(payload.product);
        this.notices.delete(ANY_PRODUCT);
      } else {
        this.notices.set(ANY_PRODUCT, "Sign-in did not work, please try again.");
      }
    } finally {
      // never leave a token (valid or not) in the address bar or history
      try {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {
        // some sandboxed frames refuse it: the page must still load
      }
    }
  }

  private restoreDraft(): void {
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (!draft) return;
      sessionStorage.removeItem(DRAFT_KEY);
      this.suggestTextarea.value = draft;
      this.suggestCharCounter.textContent = `${charCount(cleanText(draft))} / 500`;
    } catch {
      // storage blocked: nothing to restore
    }
  }

  /** Goes to the product's sign-in, keeping the visitor's unsent text for when they come back. */
  private goSignin(href: string): void {
    try {
      if (this.suggestTextarea.value.trim()) sessionStorage.setItem(DRAFT_KEY, this.suggestTextarea.value);
    } catch {
      // storage blocked: the draft is lost, sign-in still works
    }
    window.location.href = href;
  }

  private async pollIdeas(): Promise<void> {
    const started = (this.lastIdeasPoll = Date.now());
    try {
      const remote = await fetchIdeas();
      if (started < this.lastWriteAt) return; // read before our last write: would undo it on screen
      this.allIdeas = mergePolledIdeas(remote, this.recentOwn);
      const now = Date.now();
      for (const idea of this.allIdeas) {
        const hold = this.voteHolds.get(String(idea.id));
        if (hold && now - hold.at < VOTE_HOLD_MS) idea.votes = hold.votes;
        else if (hold) this.voteHolds.delete(String(idea.id));
      }
      this.recentOwn = this.recentOwn.filter((i) => this.allIdeas.includes(i));
      // a held idea the owner released is now public: show it once, from the public list
      this.heldIdeas = pruneHeldIdeas(new Set(remote.map((i) => String(i.id))));
      this.renderBoardList();
      this.renderFeedCard();
      this.renderSimilarInForm();
    } catch {
      // ignore network errors, keep existing ideas
    }
  }

  private buildDom(): void {
    // Buttons row
    this.btnBoard.type = "button";
    this.btnSuggest.type = "button";
    this.btnRow.append(this.btnBoard, this.btnSuggest);

    // Suggest Dialog
    this.suggestBackdrop.hidden = true;
    this.suggestBackdrop.id = "suggest-dialog-backdrop";

    const sHeader = el("div", "pixel-dialog-header");
    sHeader.append(el("h2", "pixel-dialog-title", "Suggest a feature"));
    const sClose = el("button", "pixel-close-btn", "X");
    sClose.type = "button";
    sClose.setAttribute("aria-label", "Close");
    sClose.addEventListener("click", () => this.closeSuggestDialog());
    sHeader.append(sClose);

    const sBody = el("div", "pixel-dialog-body");

    // Product section
    const prodSection = el("div");
    prodSection.append(el("label", "pixel-label", "Product"), this.suggestProductContainer);
    sBody.append(prodSection);
    this.suggestDialog.setAttribute("role", "dialog");
    this.suggestDialog.setAttribute("aria-modal", "true");
    this.suggestDialog.setAttribute("aria-label", "Suggest a feature");

    // Text section
    const textSection = el("div");
    this.suggestTextarea.id = "suggestion-text";
    this.suggestTextarea.rows = 4;
    this.suggestTextarea.placeholder = "Describe the feature in detail (10 - 500 characters)...";
    textSection.append(
      Object.assign(el("label", "pixel-label", "Your Suggestion"), { htmlFor: "suggestion-text" }),
      this.suggestTextarea,
      this.suggestCharCounter
    );
    sBody.append(textSection);

    // Similar ideas box
    this.similarBox.style.display = "none";
    this.similarBox.append(
      el("div", "similar-title", "Similar ideas already suggested:"),
      this.similarList
    );
    sBody.append(this.similarBox);

    // Email section
    const emailSection = el("div");
    this.suggestEmail.type = "email";
    this.suggestEmail.id = "suggestion-email";
    this.suggestEmail.maxLength = 254;
    this.suggestEmail.placeholder = "you@domain.com";
    emailSection.append(
      Object.assign(el("label", "pixel-label", "Your Email (optional)"), { htmlFor: "suggestion-email" }),
      el("div", "pixel-sublabel", "Only the team sees it, never public"),
      this.suggestEmail
    );
    sBody.append(emailSection);

    // Honeypot
    this.suggestHoneypot.type = "text";
    this.suggestHoneypot.name = "website";
    this.suggestHoneypot.style.display = "none";
    this.suggestHoneypot.tabIndex = -1;
    this.suggestHoneypot.autocomplete = "off";
    sBody.append(this.suggestHoneypot);

    // Error
    this.suggestError.style.display = "none";
    sBody.append(this.suggestError);

    // Footer
    const sFooter = el("div", "pixel-dialog-footer");
    const sCancel = el("button", "pixel-btn pixel-btn-secondary", "Cancel");
    sCancel.type = "button";
    sCancel.addEventListener("click", () => this.closeSuggestDialog());
    this.suggestSendBtn.type = "button";
    sFooter.append(sCancel, this.suggestSendBtn);

    this.suggestDialog.append(sHeader, sBody, sFooter);
    this.suggestBackdrop.append(this.suggestDialog);

    // Ideas Board Dialog
    this.boardBackdrop.hidden = true;
    this.boardBackdrop.id = "ideas-board-backdrop";

    const bHeader = el("div", "pixel-dialog-header");
    bHeader.append(el("h2", "pixel-dialog-title", "Ideas board"));
    const bClose = el("button", "pixel-close-btn", "X");
    bClose.type = "button";
    bClose.setAttribute("aria-label", "Close");
    bClose.addEventListener("click", () => this.closeBoard());
    bHeader.append(bClose);

    this.boardDialog.setAttribute("role", "dialog");
    this.boardDialog.setAttribute("aria-modal", "true");
    this.boardDialog.setAttribute("aria-label", "Ideas board");
    this.boardDialog.append(bHeader, this.boardTabsContainer, this.boardAuthBar, this.boardList);
    this.boardBackdrop.append(this.boardDialog);

    // Feed Card
    this.feedCard.setAttribute("aria-label", "Latest ideas");
    const fHead = el("div", "feed-head");
    fHead.append(el("span", "feed-title", "Latest ideas"));
    const fSeeAll = el("button", "feed-all", "See all");
    fSeeAll.type = "button";
    fSeeAll.addEventListener("click", () => this.openBoard());
    fHead.append(fSeeAll);
    this.feedCard.append(fHead, this.feedList);

    // Work Card
    this.workCard.hidden = true;
    const wHeader = el("div", "pixel-work-card-header");
    const wHeadLeft = el("div");
    wHeadLeft.style.display = "flex";
    wHeadLeft.style.alignItems = "center";
    wHeadLeft.style.gap = "8px";
    wHeadLeft.append(this.workCardProductPill, el("span", "card-title-text", "Work Card"));
    const wClose = el("button", "pixel-close-btn", "X");
    wClose.type = "button";
    wClose.setAttribute("aria-label", "Close card");
    wClose.addEventListener("click", () => { this.workCard.hidden = true; });
    wHeader.append(wHeadLeft, wClose);

    const wFooter = el("div", "pixel-work-card-footer");
    const wBadge = el("div", "card-status-badge");
    wBadge.append(el("span", "card-status-dot"), el("span", "", "Sent to the team for review"));
    const wDone = el("button", "pixel-btn pixel-btn-secondary", "Close");
    wDone.type = "button";
    wDone.addEventListener("click", () => { this.workCard.hidden = true; });
    wFooter.append(wBadge, wDone);

    this.workCard.append(wHeader, this.workCardBody, wFooter);

    this.container.append(
      this.feedCard,
      this.btnRow,
      this.suggestBackdrop,
      this.boardBackdrop,
      this.workCard
    );
  }

  private setupListeners(): void {
    this.btnSuggest.addEventListener("click", () => this.openSuggestDialog());
    this.btnBoard.addEventListener("click", () => this.openBoard());

    this.suggestBackdrop.addEventListener("click", (e) => {
      if (e.target === this.suggestBackdrop) this.closeSuggestDialog();
    });
    this.boardBackdrop.addEventListener("click", (e) => {
      if (e.target === this.boardBackdrop) this.closeBoard();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!this.suggestBackdrop.hidden) this.closeSuggestDialog();
        else if (!this.boardBackdrop.hidden) this.closeBoard();
        else if (!this.workCard.hidden) this.workCard.hidden = true;
      }
    });

    this.suggestTextarea.addEventListener("input", () => {
      const len = charCount(cleanText(this.suggestTextarea.value));
      this.suggestCharCounter.textContent = `${len} / 500`;
      this.renderSimilarInForm();
    });

    this.suggestSendBtn.addEventListener("click", () => void this.submitForm());
  }

  private openSuggestDialog(): void {
    this.suggestError.style.display = "none";
    this.suggestError.textContent = "";
    // a POST still in flight keeps Send locked, so Cancel + reopen cannot send twice
    this.suggestSendBtn.disabled = this.sending;
    this.suggestSendBtn.textContent = this.sending ? "Sending..." : "Send";
    this.renderSuggestProducts();
    this.renderSimilarInForm();
    this.suggestBackdrop.hidden = false;
    setTimeout(() => this.suggestTextarea.focus(), 50);
  }

  private closeSuggestDialog(): void {
    this.suggestBackdrop.hidden = true;
  }

  public openBoard(tab?: string): void {
    if (tab && Object.hasOwn(this.currentFeed.products, tab)) {
      this.activeProductTab = tab;
    }
    this.renderBoardTabs();
    this.renderBoardAuthBar();
    this.renderBoardList();
    this.boardBackdrop.hidden = false;
  }

  private closeBoard(): void {
    this.boardBackdrop.hidden = true;
  }

  private renderSuggestProducts(): void {
    this.suggestProductContainer.replaceChildren();
    const products = this.currentFeed.products;
    for (const [key, p] of Object.entries(products)) {
      const btn = el("button", "pixel-product-opt", p.name);
      btn.type = "button";
      if (key === this.selectedSuggestProduct) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", () => {
        this.selectedSuggestProduct = key;
        this.renderSuggestProducts();
        this.renderSimilarInForm();
      });
      this.suggestProductContainer.append(btn);
    }
  }

  private renderSimilarInForm(): void {
    const text = this.suggestTextarea.value;
    const similar = findSimilarIdeas(text, this.selectedSuggestProduct, this.allIdeas);
    if (!similar.length) {
      this.similarBox.style.display = "none";
      this.similarList.replaceChildren();
      return;
    }

    this.similarBox.style.display = "flex";
    const frag = document.createDocumentFragment();
    for (const idea of similar) {
      const li = el("li", "idea-row");
      const main = el("div", "idea-main");
      const metaDiv = el("div", "idea-meta");
      metaDiv.append(
        el("span", statusChipClass(idea.status), formatStatus(idea.status)),
        el("span", "idea-yours", `${idea.votes} ${idea.votes === 1 ? "vote" : "votes"}`)
      );
      main.append(el("div", "idea-text", idea.text), metaDiv);
      const voteBtn = this.createVoteButton(idea, () => {
        this.closeSuggestDialog();
      });
      li.append(main, voteBtn);
      frag.append(li);
    }
    this.similarList.replaceChildren(frag);
  }

  private async submitForm(): Promise<void> {
    if (this.sending) return;
    const text = cleanText(this.suggestTextarea.value);
    const email = this.suggestEmail.value.trim();
    const product = this.selectedSuggestProduct;

    this.suggestError.style.display = "none";
    this.suggestError.textContent = "";

    if (charCount(text) < 10) {
      this.suggestError.textContent = "Text must be at least 10 characters.";
      this.suggestError.style.display = "block";
      return;
    }
    if (charCount(text) > 500) {
      this.suggestError.textContent = "Text must be at most 500 characters.";
      this.suggestError.style.display = "block";
      return;
    }
    if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      this.suggestError.textContent = "Please enter a valid email address.";
      this.suggestError.style.display = "block";
      return;
    }
    if (!product || !Object.hasOwn(this.currentFeed.products, product)) {
      this.suggestError.textContent = "Please select a product.";
      this.suggestError.style.display = "block";
      return;
    }

    this.sending = true;
    this.suggestSendBtn.disabled = true;
    this.suggestSendBtn.textContent = "Sending...";

    try {
      const res = await postIdea(product, text, email, this.suggestHoneypot.value);
      this.lastWriteAt = Date.now();
      this.closeSuggestDialog();
      // clear only what was sent: the visitor may have started a new text meanwhile
      if (cleanText(this.suggestTextarea.value) === text) {
        this.suggestTextarea.value = "";
        this.suggestCharCounter.textContent = "0 / 500";
      }
      this.suggestEmail.value = "";

      const ideaId = res.id;
      if (ideaId === null) return; // the service treated it as a bot's: nothing stored, nothing to show
      saveOwnIdeaId(ideaId);
      this.ownIdeaIds.add(String(ideaId));

      const newIdea: Idea = {
        id: ideaId,
        product,
        text,
        status: "under-review",
        votes: 0,
        mine: true,
        public: res.public,
        created_at: new Date().toISOString(),
      };

      if (!res.public) {
        this.heldIdeas.push(newIdea);
        saveHeldIdea(newIdea);
      } else {
        this.recentOwn.push(newIdea);
        this.allIdeas.unshift(newIdea);
      }

      this.renderFeedCard();
      this.renderBoardList();

      this.triggerAgentWalk(ideaId, product, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit suggestion";
      this.suggestError.textContent = msg;
      this.suggestError.style.display = "block";
    } finally {
      this.sending = false;
      this.suggestSendBtn.disabled = false;
      this.suggestSendBtn.textContent = "Send";
    }
  }

  private triggerAgentWalk(ideaId: number | string, product: string, text: string): void {
    if (this.syntheticTimer6) clearTimeout(this.syntheticTimer6);
    if (this.syntheticTimer60) clearTimeout(this.syntheticTimer60);

    const agent = createSyntheticAgent(
      ideaId,
      product,
      "Got it. I received your suggestion and I will take care of it."
    );
    this.activeSyntheticAgent = agent;
    this.onSyntheticAgentUpdate(agent);

    // Focus camera on synthetic agent
    this.onFocusAgent(`factory:agent:${agent.id}`);

    // After 6s: change label to Analysing suggestion #<id> and show work card
    this.syntheticTimer6 = setTimeout(() => {
      if (this.activeSyntheticAgent && this.activeSyntheticAgent.id === agent.id) {
        this.activeSyntheticAgent = {
          ...this.activeSyntheticAgent,
          label: `Analysing suggestion #${ideaId}`,
        };
        this.onSyntheticAgentUpdate(this.activeSyntheticAgent);
        this.showWorkCard(ideaId, product, text);
      }
    }, 6_000);

    // After 60s: remove synthetic agent
    this.syntheticTimer60 = setTimeout(() => {
      if (this.activeSyntheticAgent && this.activeSyntheticAgent.id === agent.id) {
        this.activeSyntheticAgent = null;
        this.onSyntheticAgentUpdate(null);
      }
    }, 60_000);
  }

  private showWorkCard(ideaId: number | string, product: string, text: string): void {
    const prodName = this.currentFeed.products[product]?.name ?? product;
    this.workCardProductPill.textContent = prodName;

    const similar = findSimilarIdeas(text, product, this.allIdeas);
    const similarCount = similar.length;

    // Room activity info from feed agents
    const roomAgents = this.currentFeed.agents.filter((a) => a.product === product);
    const activeCount = roomAgents.filter((a) => a.state === "running").length;
    let activityText = `${roomAgents.length} ${roomAgents.length === 1 ? "agent" : "agents"} in the ${prodName} room (${activeCount} active)`;
    if (roomAgents.length > 0 && roomAgents[0].label) {
      activityText += ` · Working on: ${roomAgents[0].label}`;
    }

    const snippet = text.length > 70 ? text.slice(0, 68) + "..." : text;

    this.workCardBody.replaceChildren();

    const sec1 = el("div", "card-section");
    sec1.append(
      el("div", "card-section-label", `Suggestion #${ideaId}`),
      el("div", "card-section-value", `"${snippet}"`)
    );

    const sec2 = el("div", "card-section");
    sec2.append(
      el("div", "card-section-label", "Similar suggestions"),
      el("div", "card-section-value", similarCount === 0 ? "No similar suggestions found." : `Found ${similarCount} similar suggestion${similarCount === 1 ? "" : "s"}.`)
    );

    const sec3 = el("div", "card-section");
    sec3.append(
      el("div", "card-section-label", "Room activity"),
      el("div", "card-section-value", activityText)
    );

    this.workCardBody.append(sec1, sec2, sec3);
    this.workCard.hidden = false;
  }

  private renderBoardTabs(): void {
    this.boardTabsContainer.replaceChildren();
    for (const [key, p] of Object.entries(this.currentFeed.products)) {
      const tab = el("button", "ideas-tab", p.name);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      if (key === this.activeProductTab) {
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
      } else {
        tab.setAttribute("aria-selected", "false");
      }
      tab.addEventListener("click", () => {
        this.activeProductTab = key;
        this.renderBoardTabs();
        this.renderBoardAuthBar();
        this.renderBoardList();
      });
      this.boardTabsContainer.append(tab);
    }
  }

  private renderBoardAuthBar(): void {
    this.boardAuthBar.replaceChildren();
    const productKey = this.activeProductTab;
    const prodName = this.currentFeed.products[productKey]?.name ?? productKey;
    const token = getStoredToken(productKey);
    const signinHref = token ? null : signinUrl(this.currentFeed.products[productKey]?.voteUrl);

    const notice = this.notices.get(productKey) ?? this.notices.get(ANY_PRODUCT);
    if (notice) this.boardAuthBar.append(el("span", "ideas-auth-notice", notice), " ");
    if (token) {
      this.boardAuthBar.append(
        el("span", "", `Signed in to ${prodName}. One vote per idea, click again to remove.`)
      );
    } else if (signinHref) {
      const signinLink = el("a", "ideas-signin-link", `Sign in with ${prodName}`);
      signinLink.href = signinHref;
      signinLink.addEventListener("click", (e) => {
        e.preventDefault();
        this.goSignin(signinHref);
      });

      this.boardAuthBar.append(
        el("span", "", `Sign in with your ${prodName} account to vote: `),
        signinLink
      );
    } else {
      this.boardAuthBar.append(
        el("span", "", `Voting opens soon for ${prodName}.`)
      );
    }
  }

  private renderBoardList(): void {
    this.boardList.replaceChildren();
    const productKey = this.activeProductTab;

    // Combine public ideas with held own ideas for this product
    const held = this.heldIdeas.filter((i) => i.product === productKey);
    const publicList = this.allIdeas.filter((i) => i.product === productKey);

    const combined = [...held, ...publicList];
    combined.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

    if (!combined.length) {
      this.boardList.append(
        el("li", "ideas-empty", "No ideas suggested yet for this product. Be the first!")
      );
      return;
    }

    const frag = document.createDocumentFragment();
    for (const idea of combined) {
      const isMine = this.ownIdeaIds.has(String(idea.id)) || idea.mine;
      const li = el("li", `idea-row${isMine ? " mine" : ""}`);
      const main = el("div", "idea-main");
      main.append(el("div", "idea-text", idea.text));

      const meta = el("div", "idea-meta");
      meta.append(el("span", statusChipClass(idea.status), formatStatus(idea.status)));
      if (isMine) {
        meta.append(el("span", "idea-yours", "Your idea"));
      }
      main.append(meta);

      const voteBtn = this.createVoteButton(idea);
      li.append(main, voteBtn);
      frag.append(li);
    }
    this.boardList.append(frag);
  }

  private createVoteButton(idea: Idea, onSuccess?: () => void): HTMLButtonElement {
    const btn = el("button", "vote-btn");
    btn.type = "button";
    const isVoted = this.votedIdeaIds.has(String(idea.id));
    btn.setAttribute("aria-pressed", isVoted ? "true" : "false");
    btn.setAttribute("aria-label", `${isVoted ? "Remove vote from" : "Upvote"}: ${idea.text}`);

    const tri = el("span", "vote-tri");
    const count = el("span", "vote-count", String(idea.votes ?? 0));
    btn.append(tri, count);

    const token = getStoredToken(idea.product);
    const canVote = !!token;

    if (idea.public === false) {
      // held by the screen: the service refuses votes until the idea is public
      btn.disabled = true;
      btn.title = "Votes open once the idea is public";
    } else if (!canVote && !signinUrl(this.currentFeed.products[idea.product]?.voteUrl)) {
      btn.disabled = true;
      btn.title = "Voting opens soon";
    }

    btn.addEventListener("click", () => {
      void this.handleVoteClick(idea, btn, onSuccess);
    });

    return btn;
  }

  private async handleVoteClick(
    idea: Idea,
    btn: HTMLButtonElement,
    onSuccess?: () => void
  ): Promise<void> {
    const token = getStoredToken(idea.product);
    if (!token) {
      const href = signinUrl(this.currentFeed.products[idea.product]?.voteUrl);
      if (href) this.goSignin(href);
      return;
    }

    const currentVoted = this.votedIdeaIds.has(String(idea.id));
    const nextOn = !currentVoted;

    btn.disabled = true;
    try {
      const res = await postVote(idea.id, token, nextOn);
      this.lastWriteAt = Date.now();
      idea.votes = res.votes;
      this.voteHolds.set(String(idea.id), { votes: res.votes, at: Date.now() });
      const on = typeof res.on === "boolean" ? res.on : nextOn; // the service's answer wins
      setVotedIdeaId(idea.id, on);
      if (on) this.votedIdeaIds.add(String(idea.id));
      else this.votedIdeaIds.delete(String(idea.id));
      this.notices.delete(idea.product);
      this.notices.delete(ANY_PRODUCT);

      this.renderBoardList();
      this.renderFeedCard();
      this.renderSimilarInForm();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        removeStoredToken(idea.product);
        this.notices.set(idea.product, "Your sign-in expired.");
      } else {
        this.notices.set(idea.product, err instanceof Error ? err.message : "Vote failed");
      }
      this.renderBoardAuthBar();
      this.renderBoardList();
      this.renderSimilarInForm();
      if (!this.suggestBackdrop.hidden) {
        this.suggestError.textContent = this.notices.get(idea.product) ?? "";
        this.suggestError.style.display = "block";
      }
    } finally {
      btn.disabled = false;
    }
  }

  private renderFeedCard(): void {
    const isNarrow = window.innerWidth <= 480;
    const limit = isNarrow ? 2 : 3;

    // Combine public ideas and held own ideas
    const combined = [...this.heldIdeas, ...this.allIdeas];
    const latest = selectLatestIdeas(combined, limit);

    this.feedList.replaceChildren();

    if (!latest.length) {
      this.feedCard.style.display = "none";
      return;
    }
    this.feedCard.style.display = "block";

    const frag = document.createDocumentFragment();
    for (const idea of latest) {
      const isMine = this.ownIdeaIds.has(String(idea.id)) || idea.mine;
      const li = el("li", `feed-row${isMine ? " mine" : ""}`);
      const btn = el("button", "feed-btn");
      btn.type = "button";
      btn.setAttribute("aria-label", `Open ${idea.product} idea on Ideas board`);

      const meta = el("div", "feed-meta");
      const prodName = this.currentFeed.products[idea.product]?.name ?? idea.product;
      const ageStr = `${formatRelativeTime(idea.created_at)}${isMine ? ", yours" : ""}`;

      meta.append(
        el("span", "feed-product", prodName),
        el("span", "feed-ago", ageStr),
        el("span", "feed-votes", `▲ ${idea.votes ?? 0}`)
      );

      btn.append(meta, el("div", "feed-text", idea.text));
      btn.addEventListener("click", () => {
        this.openBoard(idea.product);
      });

      li.append(btn);
      frag.append(li);
    }
    this.feedList.append(frag);
  }
}
