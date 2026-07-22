export interface SearchResult {
  id: number;
  name: string;
  subtitle: string;
  price: number;
  relative_price: number;
  relative_price_unit: string;
}

export interface ProductPage {
  page_url: string;
  items: SearchResult[];
  has_more: boolean;
}

export interface CartItem {
  id: number;
  name: string;
  subtitle: string;
  quantity: number;
  price: number;
  relative_price: number;
  relative_price_unit: string;
}

export interface Recipe {
  id: number;
  name: string;
  image_url?: string;
  duration?: string;
  difficulty?: string;
}

export interface RecipeFilter {
  id: string;
  name: string;
  count: number;
  category: string;
}

export interface RecipePage {
  page_url: string;
  filters: RecipeFilter[];
  items: Recipe[];
  has_more: boolean;
}

export interface RecipeDetail {
  name: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  image_url?: string;
}

// The Oda slot-picker API returns snake_case keys (verified at runtime), so these
// types mirror that exactly. Do not "camelCase" them — the fields are accessed by
// their real wire names.
export interface DeliveryAddress {
  id: number;
  address_display?: string;
  address_display_full: string;
  is_primary: boolean;
  is_delivery_available?: boolean;
}

export interface DeliverySlot {
  id: number;
  route_group: number;
  route_group_str: string;
  open_datetime: string;
  close_datetime: string;
  cutoff_time: string;
  is_selected: boolean;
  is_full: boolean;
  price: string;
  is_unavailable: boolean;
  unavailable_description: string | null;
  is_cheapest: boolean;
}

export interface CartDeliveryInfo {
  delivery_slot: number | null;
  is_unattended_delivery: boolean;
  delivery_address: DeliveryAddress | null;
  country: string;
}

export interface DeliverySlotsResponse {
  delivery_slots: DeliverySlot[];
  has_earlier: boolean;
  has_later: boolean;
  from_index: number;
  cart_info: CartDeliveryInfo;
  delivery_addresses: DeliveryAddress[];
  validator_messages: string[];
  time_zone: string;
}

export interface ProductListSummary {
  id: number;
  title: string;
  description: string;
  number_of_products: number;
  total_quantity: number;
}

export interface ProductListDetail extends ProductListSummary {
  items: CartItem[];
}
