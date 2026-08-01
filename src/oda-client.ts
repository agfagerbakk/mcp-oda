import {
  SearchResult,
  ProductPage,
  CartItem,
  Recipe,
  RecipeFilter,
  RecipePage,
  RecipeDetail,
  DeliverySlotsResponse,
  ProductListSummary,
  ProductListDetail,
} from "./types.js";
import fs from "fs";

export class OdaClient {
  static BASE_URL = "https://oda.com/no";
  static API_BASE = "https://oda.com";
  static CART_API = "https://oda.com/api/v1/cart/";
  static CART_ITEMS_API = "https://oda.com/api/v1/cart/items/";
  static SLOT_PICKER_API = "https://oda.com/api/v1/slot-picker/slots/";
  static SLOT_SELECT_API = "https://oda.com/api/v1/slot-picker/info/";
  static PRODUCT_LISTS_API = "https://oda.com/api/v1/product-lists/";

  private cookies: Record<string, string> = {};
  private readonly headers: Record<string, string>;

  constructor(private cookiePath: string) {
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "no,nb;q=0.9,en;q=0.8",
    };
    this.loadCookies();
  }

  // --- Cookie management ---

  private loadCookies() {
    try {
      if (!fs.existsSync(this.cookiePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.cookiePath, "utf-8"));

      if (Array.isArray(raw)) {
        // Playwright format: [{name, value, domain, ...}, ...]
        for (const c of raw) {
          if (c.name && c.value !== undefined) {
            this.cookies[c.name] = String(c.value);
          }
        }
      } else if (typeof raw === "object" && raw !== null) {
        // Simple format: {name: value, ...}
        for (const [k, v] of Object.entries(raw)) {
          this.cookies[k] = String(v);
        }
      }
    } catch {
      // Ignore corrupt cookie files
    }
  }

  saveCookies() {
    fs.writeFileSync(this.cookiePath, JSON.stringify(this.cookies, null, 2));
  }

  private updateCookies(response: Response) {
    const setCookies = response.headers.getSetCookie();
    for (const header of setCookies) {
      const parts = header.split(";")[0];
      const eq = parts.indexOf("=");
      if (eq > 0) {
        const name = parts.substring(0, eq).trim();
        const value = parts.substring(eq + 1).trim();
        this.cookies[name] = value;
      }
    }
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  getCsrfToken(): string | null {
    return this.cookies["csrftoken"] || null;
  }

  // --- Core HTTP methods ---

  async get(url: string): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        ...this.headers,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: this.cookieHeader(),
      },
      redirect: "manual",
    });
    this.updateCookies(response);
    return response;
  }

  async getFollowRedirects(url: string): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        ...this.headers,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: this.cookieHeader(),
      },
      redirect: "follow",
    });
    this.updateCookies(response);
    return response;
  }

  private async apiPost(
    url: string,
    body: any,
    referer?: string,
  ): Promise<Response> {
    const csrf = this.getCsrfToken();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers,
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: this.cookieHeader(),
        Origin: OdaClient.API_BASE,
        Referer: referer || `${OdaClient.BASE_URL}/`,
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    this.updateCookies(response);
    return response;
  }

  private async apiGet(url: string): Promise<Response> {
    const csrf = this.getCsrfToken();
    const response = await fetch(url, {
      headers: {
        ...this.headers,
        Accept: "application/json",
        Cookie: this.cookieHeader(),
        Origin: OdaClient.API_BASE,
        Referer: `${OdaClient.BASE_URL}/`,
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
      },
      redirect: "follow",
    });
    this.updateCookies(response);
    return response;
  }

  private async apiDelete(url: string): Promise<Response> {
    const csrf = this.getCsrfToken();
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        ...this.headers,
        Accept: "application/json",
        Cookie: this.cookieHeader(),
        Origin: OdaClient.API_BASE,
        Referer: `${OdaClient.BASE_URL}/cart/`,
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
      },
      redirect: "manual",
    });
    this.updateCookies(response);
    return response;
  }

  // --- HTML parsing ---

  private extractNextData(html: string): any | null {
    const match = html.match(
      /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s,
    );
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // fall through to the App Router path below
      }
    }
    // Next.js App Router (13+) no longer emits a <script id="__NEXT_DATA__">
    // blob. The dehydrated React Query cache is instead streamed as a series of
    // self.__next_f.push([...]) RSC chunks. Reassemble those and synthesize the
    // legacy shape so findDehydratedQuery keeps working unchanged.
    return this.extractNextFlightData(html);
  }

  /**
   * Recover the dehydrated React Query state from the App Router's streamed
   * flight payload and wrap it in the legacy __NEXT_DATA__ shape
   * ({ props: { pageProps: { dehydratedState: { queries } } } }) so all existing
   * findDehydratedQuery("mixedSearch" / "user" / …) callers work untouched.
   */
  private extractNextFlightData(html: string): any | null {
    const flight = this.reassembleNextFlight(html);
    if (!flight) return null;
    const queries = this.collectDehydratedQueries(flight);
    if (queries.length === 0) return null;
    return { props: { pageProps: { dehydratedState: { queries } } } };
  }

  /**
   * Concatenate the string payloads of every `self.__next_f.push([...])` call
   * into the single flight stream React streamed to the client. Each push arg
   * is a JSON array literal like `[1,"<chunk>"]`; we join the string elements.
   */
  private reassembleNextFlight(html: string): string {
    const marker = "self.__next_f.push(";
    const parts: string[] = [];
    let idx = 0;
    while ((idx = html.indexOf(marker, idx)) !== -1) {
      const parenStart = idx + marker.length - 1; // index of the '('
      const argExpr = this.matchBalanced(html, parenStart); // '(...)' inclusive
      if (!argExpr) {
        idx = parenStart + 1;
        continue;
      }
      idx = parenStart + argExpr.length;
      try {
        const arr = JSON.parse(argExpr.slice(1, -1)); // strip the parens
        if (Array.isArray(arr)) {
          for (const el of arr) if (typeof el === "string") parts.push(el);
        }
      } catch {
        // a non-JSON push (e.g. the bootstrap `self.__next_f=[]`) — skip it
      }
    }
    return parts.join("");
  }

  /**
   * Pull every dehydrated-query entry out of the flight stream. React Query
   * serializes its cache as one or more `"queries":[ … ]` arrays (there can be
   * several, streamed from different Suspense boundaries), so gather them all.
   */
  private collectDehydratedQueries(flight: string): any[] {
    const needle = '"queries":';
    const queries: any[] = [];
    let idx = 0;
    while ((idx = flight.indexOf(needle, idx)) !== -1) {
      const arrStart = flight.indexOf("[", idx + needle.length);
      idx += needle.length;
      if (arrStart === -1) continue;
      if (flight.slice(idx, arrStart).trim() !== "") continue; // not `"queries": [`
      const arrText = this.matchBalanced(flight, arrStart);
      if (!arrText) continue;
      idx = arrStart + arrText.length;
      try {
        const parsed = JSON.parse(arrText);
        if (Array.isArray(parsed)) queries.push(...parsed);
      } catch {
        // partial/streamed fragment that isn't valid JSON on its own — skip
      }
    }
    return queries;
  }

  /**
   * From an opening delimiter (`(`, `[` or `{`) at `start`, return the balanced
   * substring up to and including its matching close, correctly stepping over
   * JSON string literals (and their escapes) so brackets inside strings don't
   * throw off the depth count. Returns null if it never balances.
   */
  private matchBalanced(s: string, start: number): string | null {
    const open = s[start];
    const close = open === "(" ? ")" : open === "[" ? "]" : open === "{" ? "}" : "";
    if (!close) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < s.length; j++) {
      const c = s[j];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === open) depth++;
      else if (c === close && --depth === 0) return s.slice(start, j + 1);
    }
    return null;
  }

  private extractJsonLd(html: string): any[] {
    const results: any[] = [];
    const regex = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
    let m;
    while ((m = regex.exec(html)) !== null) {
      try {
        results.push(JSON.parse(m[1]));
      } catch {
        // skip malformed
      }
    }
    return results;
  }

  async fetchNextData(url: string): Promise<any | null> {
    const response = await this.getFollowRedirects(url);
    if (response.status === 425) {
      throw new Error(
        "Server returned 425 Too Early. Please try again later.",
      );
    }
    const html = await response.text();
    return this.extractNextData(html);
  }

  async fetchJsonLd(url: string): Promise<any[]> {
    const response = await this.getFollowRedirects(url);
    if (response.status === 425) {
      throw new Error(
        "Server returned 425 Too Early. Please try again later.",
      );
    }
    const html = await response.text();
    return this.extractJsonLd(html);
  }

  /**
   * Find a specific query result from dehydrated React Query state.
   * The __NEXT_DATA__ contains queries keyed by queryKey arrays.
   * Supports both old string keys (key[0] === prefix) and new object
   * keys (key[0]._id === prefix).
   */
  private findDehydratedQuery(nextData: any, keyPrefix: string): any | null {
    const queries =
      nextData?.props?.pageProps?.dehydratedState?.queries || [];
    for (const q of queries) {
      const key = q.queryKey;
      if (!Array.isArray(key) || key.length === 0) continue;
      const first = key[0];
      if (first === keyPrefix || (typeof first === "object" && first?._id === keyPrefix)) {
        return q.state?.data ?? null;
      }
    }
    return null;
  }

  // --- Dump helper (for CLI discovery) ---

  async dump(url: string): Promise<{
    nextData: any | null;
    jsonLd: any[];
    headers: Record<string, string>;
    status: number;
    finalUrl: string;
  }> {
    const response = await this.getFollowRedirects(url);
    const html = await response.text();

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      nextData: this.extractNextData(html),
      jsonLd: this.extractJsonLd(html),
      headers: responseHeaders,
      status: response.status,
      finalUrl: response.url,
    };
  }

  // --- Product methods ---

  async searchProducts(query: string, page = 1): Promise<ProductPage> {
    const url = `${OdaClient.BASE_URL}/search/products/?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ""}`;
    const nextData = await this.fetchNextData(url);
    return this.parseProductPage(url, nextData);
  }

  private parseProductPage(url: string, nextData: any): ProductPage {
    if (!nextData) {
      return { page_url: url, items: [], has_more: false };
    }

    try {
      // Data is in dehydrated React Query state (key: "mixedSearch" or legacy "searchpageresponse")
      const data = this.findDehydratedQuery(nextData, "mixedSearch")
        ?? this.findDehydratedQuery(nextData, "searchpageresponse");
      if (!data || !data.items) {
        return { page_url: url, items: [], has_more: false };
      }

      const has_more = data.attributes?.hasMoreItems === true;

      const items: SearchResult[] = [];

      for (const item of data.items) {
        if (item.type !== "product") continue;
        const a = item.attributes;
        if (!a) continue;

        const id = a.id || item.id;
        const name = a.fullName || a.name || "Unknown";
        const subtitle = a.nameExtra || "";
        const price = parseFloat(a.grossPrice) || 0;
        const unitPrice = parseFloat(a.grossUnitPrice) || 0;
        const unitPriceUnit = a.unitPriceQuantityAbbreviation || "";

        items.push({
          id,
          name,
          subtitle,
          price,
          relative_price: unitPrice,
          relative_price_unit: unitPriceUnit ? `/${unitPriceUnit}` : "",
        });
      }

      return { page_url: url, items, has_more };
    } catch (e) {
      console.error("Failed to parse product page", e);
      return { page_url: url, items: [], has_more: false };
    }
  }

  // --- Cart methods ---

  async getCartContents(): Promise<CartItem[]> {
    // Cart data is not in __NEXT_DATA__, use the REST API directly
    const response = await this.apiGet(OdaClient.CART_API);
    if (response.status === 425) {
      throw new Error(
        "Server returned 425 Too Early. Please try again later.",
      );
    }
    if (!response.ok) {
      return [];
    }

    try {
      const data = await response.json();
      return this.parseCartApi(data);
    } catch (e) {
      console.error("Failed to parse cart API response", e);
      return [];
    }
  }

  // Shared by cart and product-list responses: both nest a Django-side
  // (snake_case) product under an {product, quantity} wrapper.
  private parseWireItem(item: any): CartItem {
    const product = item.product || {};
    const unitPriceUnit = product.unit_price_quantity_abbreviation || "";

    return {
      id: product.id,
      name: product.full_name || product.name || "Unknown Product",
      subtitle: product.name_extra || "",
      quantity: item.quantity || 1,
      price: parseFloat(product.gross_price) || 0,
      relative_price: parseFloat(product.gross_unit_price) || 0,
      relative_price_unit: unitPriceUnit ? `/${unitPriceUnit}` : "",
    };
  }

  private parseCartApi(data: any): CartItem[] {
    // Items can be at top-level or nested under groups
    const rawItems: any[] = data.items || [];
    for (const group of data.groups || []) {
      rawItems.push(...(group.items || []));
    }

    return rawItems.map((item) => this.parseWireItem(item));
  }

  async addToCart(productId: number, count = 1): Promise<void> {
    const response = await this.apiPost(
      OdaClient.CART_ITEMS_API,
      { items: [{ product_id: productId, quantity: count }] },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Add to cart failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  async removeFromCart(productId: number, count = 1): Promise<void> {
    const response = await this.apiPost(
      OdaClient.CART_ITEMS_API,
      { items: [{ product_id: productId, quantity: -count }] },
      `${OdaClient.BASE_URL}/cart/`,
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Remove from cart failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  async clearCart(): Promise<void> {
    const response = await this.apiPost(
      `${OdaClient.API_BASE}/api/v1/cart/clear/`,
      {},
      `${OdaClient.BASE_URL}/cart/`,
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Clear cart failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  // --- Recipe methods ---

  async searchRecipes(query?: string | null, page = 1, filterIds?: string[]): Promise<RecipePage> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (page > 1) params.set("page", String(page));
    if (filterIds?.length) params.set("filters", filterIds.join(","));
    const qs = params.toString();
    const url = `${OdaClient.BASE_URL}/recipes/all/${qs ? `?${qs}` : ""}`;
    const nextData = await this.fetchNextData(url);
    return this.parseRecipePage(url, nextData);
  }

  private parseRecipePage(url: string, nextData: any): RecipePage {
    if (!nextData) {
      return { page_url: url, filters: [], items: [], has_more: false };
    }

    try {
      // Data is in dehydrated React Query state (key: "mixedSearch" or legacy "searchresponse")
      const data = this.findDehydratedQuery(nextData, "mixedSearch")
        ?? this.findDehydratedQuery(nextData, "searchresponse");
      if (!data || !data.items) {
        return { page_url: url, filters: [], items: [], has_more: false };
      }

      const has_more = data.attributes?.hasMoreItems === true;

      // Filters: data.filters[] can be filtergroup or flat filter
      const filters: RecipeFilter[] = [];
      for (const f of data.filters || []) {
        if (f.type === "filtergroup" && f.items) {
          const category = f.displayName || f.name || "Unknown";
          for (const opt of f.items) {
            filters.push({
              id: `${opt.name}:${opt.value}`,
              name: opt.displayValue || opt.value || "",
              count: opt.count || 0,
              category,
            });
          }
        } else if (f.type === "filter") {
          filters.push({
            id: `${f.name}:${f.value}`,
            name: f.displayValue || f.value || "",
            count: f.count || 0,
            category: "Filter",
          });
        }
      }

      // Recipe items
      const items: Recipe[] = [];

      for (const item of data.items) {
        if (item.type !== "recipe") continue;
        const a = item.attributes;
        if (!a) continue;

        const recipeId = a.id || item.id;
        const name = a.title || "Unknown Recipe";
        const imageUrl = a.featureImageUrl || undefined;
        const duration = a.cookingDurationString || undefined;
        const difficulty = a.difficultyString || a.difficulty || undefined;

        items.push({
          id: recipeId,
          name,
          image_url: imageUrl,
          duration,
          difficulty,
        });
      }

      return { page_url: url, filters, items, has_more };
    } catch (e) {
      console.error("Failed to parse recipe page", e);
      return { page_url: url, filters: [], items: [], has_more: false };
    }
  }

  private async getRecipeData(recipeId: number): Promise<any> {
    const url = `${OdaClient.BASE_URL}/recipes/${recipeId}`;
    const nextData = await this.fetchNextData(url);
    if (!nextData) {
      throw new Error(`Could not load recipe page for ID ${recipeId}`);
    }
    const data = this.findDehydratedQuery(nextData, "recipeDetailApi")
      ?? this.findDehydratedQuery(nextData, "get-recipe-detail");
    if (!data) {
      throw new Error(`Could not find recipe data for ID ${recipeId}`);
    }
    return data;
  }

  async getRecipeDetails(recipeId: number): Promise<RecipeDetail> {
    const data = await this.getRecipeData(recipeId);
    return this.createRecipeDetailFromApi(data);
  }

  private createRecipeDetailFromApi(data: any): RecipeDetail {
    const name = data.title || "Unknown";
    const description = data.lead || "";
    const imageUrl = data.featureImageUrl || undefined;

    // Ingredients from ingredientsDisplayList
    const ingredients: string[] = (data.ingredientsDisplayList || []).map(
      (ing: any) => {
        const qty = parseFloat(ing.displayQuantity) || 0;
        const unit = ing.displayUnit || "";
        const title = ing.title || "";
        // Format as "250 g Mozzarella, fersk" or "1 stk Pizzabunn"
        const qtyStr = qty % 1 === 0 ? String(Math.round(qty)) : String(qty);
        return `${qtyStr} ${unit} ${title}`.trim();
      },
    );

    // Instructions
    const instructions: string[] = (
      data.instructions?.instructions || []
    ).map((step: any) => step.text || "");

    return { name, description, ingredients, instructions, image_url: imageUrl };
  }

  async addRecipeToCart(
    recipeId: number,
    portions: number,
  ): Promise<void> {
    const data = await this.getRecipeData(recipeId);
    const ingredients: any[] = data.ingredients || [];
    const items = ingredients
      .filter((ing: any) => ing.product?.id)
      .map((ing: any) => ({
        product_id: ing.product.id,
        quantity: (parseFloat(ing.portionQuantity) || 0) * portions,
        from_recipe_id: recipeId,
        from_recipe_portions: portions,
      }));

    const response = await this.apiPost(
      `${OdaClient.CART_ITEMS_API}?group_by=recipes`,
      { items },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Add recipe to cart failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  async removeRecipeFromCart(recipeId: number): Promise<void> {
    const response = await this.apiPost(
      `${OdaClient.CART_ITEMS_API}?group_by=recipes`,
      { items: [{ recipe_id: recipeId, quantity: -1, delete: true }] },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Remove recipe from cart failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  // --- Delivery slot methods ---

  async getDeliverySlots(numDays = 4, fromIndex = 0): Promise<DeliverySlotsResponse> {
    const url = `${OdaClient.SLOT_PICKER_API}?num-days=${numDays}&from-index=${fromIndex}`;
    const response = await this.apiGet(url);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Get delivery slots failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
    return response.json() as Promise<DeliverySlotsResponse>;
  }

  async selectDeliverySlot(slotId: number, addressId?: number, unattended = false): Promise<void> {
    let resolvedAddressId = addressId;
    if (resolvedAddressId === undefined) {
      const slots = await this.getDeliverySlots();
      resolvedAddressId = slots.cart_info.delivery_address?.id;
      if (resolvedAddressId === undefined) {
        throw new Error("No delivery address found; please specify an address ID");
      }
    }

    const response = await this.apiPost(
      OdaClient.SLOT_SELECT_API,
      {
        deliverySlotId: slotId,
        isUnattendedDelivery: unattended,
        inModal: true,
        deliveryAddressId: resolvedAddressId,
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Select delivery slot failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  // --- Product list methods ---
  //
  // Oda calls these "product lists" internally (URL: /no/account/lists/); the
  // UI label is "Lister". Saved, reusable groups of products (distinct from the
  // cart) that you can create, edit, and re-add to the cart in bulk.
  //
  // Setting is_dinner_list turns the SAME object into a self-authored recipe —
  // it gets its own page under Oda's Recipes -> Your Dinners, and `description`
  // doubles as free-text cooking instructions. It's toggleable after creation
  // too (confirmed against the real API), not just at creation time.

  private parseProductListSummary(data: any): ProductListSummary {
    return {
      id: data.id,
      title: data.title,
      description: data.description || "",
      number_of_products: data.number_of_products || 0,
      total_quantity: data.total_quantity || 0,
      is_dinner_list: !!data.is_dinner_list,
    };
  }

  async getProductLists(): Promise<ProductListSummary[]> {
    const response = await this.apiGet(OdaClient.PRODUCT_LISTS_API);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Get product lists failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
    const data = await response.json();
    return (data.results || []).map((r: any) => this.parseProductListSummary(r));
  }

  async getProductList(id: number): Promise<ProductListDetail> {
    const response = await this.apiGet(`${OdaClient.PRODUCT_LISTS_API}${id}/`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Get product list failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
    const data = await response.json();
    return {
      ...this.parseProductListSummary(data),
      items: (data.items || []).map((item: any) => this.parseWireItem(item)),
    };
  }

  async createProductList(
    title: string,
    description = "",
    isDinnerList = false,
  ): Promise<ProductListSummary> {
    const response = await this.apiPost(OdaClient.PRODUCT_LISTS_API, {
      title,
      description,
      is_dinner_list: isDinnerList,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Create product list failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
    return this.parseProductListSummary(await response.json());
  }

  async renameProductList(
    id: number,
    fields: { title?: string; description?: string; isDinnerList?: boolean },
  ): Promise<ProductListSummary> {
    // The API requires `title` on every update, even one that only changes the
    // description — fetch the current one first so callers can update just one field.
    const title = fields.title ?? (await this.getProductList(id)).title;
    const response = await this.apiPost(`${OdaClient.PRODUCT_LISTS_API}${id}/`, {
      title,
      description: fields.description,
      ...(fields.isDinnerList !== undefined ? { is_dinner_list: fields.isDinnerList } : {}),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Rename product list failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
    return this.parseProductListSummary(await response.json());
  }

  async deleteProductList(id: number): Promise<void> {
    const response = await this.apiDelete(`${OdaClient.PRODUCT_LISTS_API}${id}/`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Delete product list failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  /** Add products to a list. Quantities are additive with whatever is already there. */
  async addProductsToList(
    id: number,
    items: { product_id: number; quantity: number }[],
  ): Promise<ProductListDetail> {
    const response = await this.apiPost(`${OdaClient.PRODUCT_LISTS_API}${id}/products/`, items);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Add products to list failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
    const data = await response.json();
    return {
      ...this.parseProductListSummary(data),
      items: (data.items || []).map((item: any) => this.parseWireItem(item)),
    };
  }

  /**
   * Remove a product from a list entirely. The API tracks quantity as a delta,
   * so removal requires posting the negative of the current quantity together
   * with `delete: true` (a zero-quantity delta or a delta that doesn't reach
   * exactly zero just leaves a zero-quantity row instead of dropping it).
   */
  async removeProductFromList(id: number, productId: number): Promise<void> {
    const list = await this.getProductList(id);
    const item = list.items.find((i) => i.id === productId);
    if (!item) return;

    const response = await this.apiPost(`${OdaClient.PRODUCT_LISTS_API}${id}/products/`, [
      { product_id: productId, quantity: -item.quantity, delete: true },
    ]);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Remove product from list failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  /**
   * Add every item in a saved list (or dinner/recipe) to the cart in one shot.
   * The cart API accepts `product_list_id` directly and groups the resulting
   * cart items under a "dinners" section for dinner lists — one call instead
   * of fetching the list and re-posting each product individually. `quantity`
   * here is required by the schema but has no scaling effect (verified against
   * the real API: quantity 3 still added each ingredient at its own list qty).
   */
  async addProductListToCart(id: number): Promise<void> {
    const response = await this.apiPost(OdaClient.CART_ITEMS_API, {
      items: [{ product_list_id: id, quantity: 1 }],
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Add list to cart failed: HTTP ${response.status}${body ? ` – ${body.slice(0, 500)}` : ""}`);
    }
  }

  // --- Auth methods ---

  async login(email: string, password: string): Promise<boolean> {
    // First GET the login page to get CSRF token
    await this.getFollowRedirects(`${OdaClient.BASE_URL}/user/login/`);

    const response = await this.apiPost(
      `${OdaClient.API_BASE}/api/v1/user/login/`,
      { username: email, password },
      `${OdaClient.BASE_URL}/user/login/`,
    );

    if (response.ok) {
      this.saveCookies();
      return true;
    }

    return false;
  }

  async checkUser(): Promise<string | null> {
    // Use dehydrated query "user" from any page
    const nextData = await this.fetchNextData(`${OdaClient.BASE_URL}/cart/`);
    return this.extractUserName(nextData);
  }

  private extractUserName(nextData: any): string | null {
    if (!nextData) return null;
    try {
      const user = this.findDehydratedQuery(nextData, "user");
      if (user) {
        const name =
          `${user.firstName || ""} ${user.lastName || ""}`.trim();
        return name || user.email || null;
      }
    } catch {
      // ignore
    }
    return null;
  }
}
