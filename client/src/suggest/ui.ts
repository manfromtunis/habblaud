import type { Idea, IdeaStatus } from "./types";
import { parseVoteToken, isTokenExpired, extractHashToken, getStoredToken, saveStoredToken, removeStoredToken } from "./token";
import { findSimilarIdeas } from "./similar";
import { selectLatestIdeas, formatRelativeTime } from "./feed";
import { createSyntheticAgent, mergeSyntheticAgent } from "./synthetic";
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

  constructor(options: SuggestManagerOptions) {
    this.container = options.container;
    this.onSyntheticAgentUpdate = options.onSyntheticAgentUpdate;
    this.onFocusAgent = options.onFocusAgent;

    this.initTokenFromUrl();
    window.addEventListener("hashchange", () => this.initTokenFromUrl());
    this.buildDom();
    this.setupListeners();
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
    try {
      const hash = window.location.hash;
      const token = extractHashToken(hash);
      if (token) {
        const payload = parseVoteToken(token);
        if (payload && !isTokenExpired(payload)) {
          saveStoredToken(payload.product, token);
        }
        if (window.history && typeof window.history.replaceState === "function") {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      }
    } catch {
      // ignore
    }
  }

  private async pollIdeas(): Promise<void> {
    this.lastIdeasPoll = Date.now();
    try {
      const remote = await fetchIdeas();
      this.allIdeas = remote;
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

    // Text section
    const textSection = el("div");
    this.suggestTextarea.id = "suggestion-text";
    this.suggestTextarea.rows = 4;
    this.suggestTextarea.placeholder = "Describe the feature in detail (10 - 500 characters)...";
    textSection.append(
      el("label", "pixel-label", "Your Suggestion"),
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
    this.suggestEmail.placeholder = "you@domain.com";
    emailSection.append(
      el("label", "pixel-label", "Your Email (optional)"),
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
      const len = this.suggestTextarea.value.length;
      this.suggestCharCounter.textContent = `${len} / 500`;
      this.renderSimilarInForm();
    });

    this.suggestSendBtn.addEventListener("click", () => void this.submitForm());
  }

  private openSuggestDialog(): void {
    this.suggestError.style.display = "none";
    this.suggestError.textContent = "";
    this.suggestSendBtn.disabled = false;
    this.suggestSendBtn.textContent = "Send";
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
    const text = this.suggestTextarea.value.trim();
    const email = this.suggestEmail.value.trim();
    const product = this.selectedSuggestProduct;

    this.suggestError.style.display = "none";
    this.suggestError.textContent = "";

    if (text.length < 10) {
      this.suggestError.textContent = "Text must be at least 10 characters.";
      this.suggestError.style.display = "block";
      return;
    }
    if (text.length > 500) {
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

    this.suggestSendBtn.disabled = true;
    this.suggestSendBtn.textContent = "Sending...";

    try {
      const res = await postIdea(product, text, email);
      this.closeSuggestDialog();
      this.suggestTextarea.value = "";
      this.suggestCharCounter.textContent = "0 / 500";
      this.suggestEmail.value = "";

      const ideaId = res.id;
      saveOwnIdeaId(ideaId);

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
        this.allIdeas.unshift(newIdea);
      }

      this.renderFeedCard();
      this.renderBoardList();

      this.triggerAgentWalk(ideaId, product, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit suggestion";
      this.suggestError.textContent = msg;
      this.suggestError.style.display = "block";
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
      el("div", "card-section-label", "Room Activity"),
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
    const voteUrl = this.currentFeed.products[productKey]?.voteUrl;

    if (token) {
      const payload = parseVoteToken(token);
      this.boardAuthBar.append(
        el("span", "", `Signed in to ${prodName}. One vote per idea, click again to remove.`)
      );
    } else if (voteUrl && typeof voteUrl === "string" && voteUrl.startsWith("https://")) {
      const returnUrl = encodeURIComponent(window.location.origin + window.location.pathname);
      const signinHref = `${voteUrl}${voteUrl.includes("?") ? "&" : "?"}return=${returnUrl}`;
      const signinLink = el("a", "ideas-signin-link", `Sign in with ${prodName}`);
      signinLink.href = signinHref;

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
    const voteUrl = this.currentFeed.products[idea.product]?.voteUrl;
    const canVote = !!token;

    if (!canVote && (!voteUrl || !voteUrl.startsWith("https://"))) {
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
    const voteUrl = this.currentFeed.products[idea.product]?.voteUrl;

    if (!token) {
      if (voteUrl && voteUrl.startsWith("https://")) {
        const returnUrl = encodeURIComponent(window.location.origin + window.location.pathname);
        window.location.href = `${voteUrl}${voteUrl.includes("?") ? "&" : "?"}return=${returnUrl}`;
      }
      return;
    }

    const currentVoted = this.votedIdeaIds.has(String(idea.id));
    const nextOn = !currentVoted;

    btn.disabled = true;
    try {
      const res = await postVote(idea.id, token, nextOn);
      idea.votes = res.votes;
      setVotedIdeaId(idea.id, nextOn);
      if (nextOn) this.votedIdeaIds.add(String(idea.id));
      else this.votedIdeaIds.delete(String(idea.id));

      this.renderBoardList();
      this.renderFeedCard();
      this.renderSimilarInForm();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        removeStoredToken(idea.product);
        this.renderBoardAuthBar();
        this.renderBoardList();
      } else {
        const msg = err instanceof Error ? err.message : "Vote failed";
        alert(msg);
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
