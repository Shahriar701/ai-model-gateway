/**
 * Product data models for MCP integration
 * E-commerce product catalog types
 */

export interface Product {
  id: string;
  name: string;
  description: string;
  price: Price;
  availability: Availability;
  category: Category;
  specifications: ProductSpecifications;
  images: ProductImage[];
  rating?: ProductRating;
  seller?: Seller;
  metadata: ProductMetadata;
}

export interface Price {
  amount: number;
  currency: string;
  originalPrice?: number;
  discount?: Discount;
  priceHistory?: PriceHistoryEntry[];
}

export interface Discount {
  percentage: number;
  amount: number;
  validUntil?: string;
  code?: string;
}

export interface PriceHistoryEntry {
  date: string;
  price: number;
}

export interface Availability {
  inStock: boolean;
  quantity?: number;
  restockDate?: string;
  shippingTime?: string;
  locations?: string[];
}

export interface Category {
  id: string;
  name: string;
  path: string[];
  attributes?: CategoryAttribute[];
}

export interface CategoryAttribute {
  name: string;
  value: string;
  unit?: string;
}

export interface ProductSpecifications {
  brand?: string;
  model?: string;
  color?: string;
  size?: string;
  weight?: string;
  dimensions?: Dimensions;
  features?: string[];
  technicalDetails?: Record<string, string>;
}

export interface Dimensions {
  length: number;
  width: number;
  height: number;
  unit: string;
}

export interface ProductImage {
  url: string;
  alt: string;
  type: 'main' | 'thumbnail' | 'gallery';
  order: number;
}

export interface ProductRating {
  average: number;
  count: number;
  distribution?: RatingDistribution;
}

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface Seller {
  id: string;
  name: string;
  rating?: number;
  verified: boolean;
}

export interface ProductMetadata {
  createdAt: string;
  updatedAt: string;
  views?: number;
  sales?: number;
  tags?: string[];
  seo?: SEOMetadata;
}

export interface SEOMetadata {
  title: string;
  description: string;
  keywords: string[];
}

/**
 * Product search and filtering
 */
export interface ProductSearchQuery {
  query: string;
  filters?: ProductFilters;
  sort?: ProductSort;
  pagination?: Pagination;
}

export interface ProductFilters {
  category?: string;
  priceRange?: {
    min: number;
    max: number;
  };
  availability?: boolean;
  brand?: string[];
  rating?: number;
  seller?: string;
  attributes?: Record<string, string>;
}

export interface ProductSort {
  field: 'price' | 'rating' | 'popularity' | 'newest' | 'relevance';
  order: 'asc' | 'desc';
}

export interface Pagination {
  limit: number;
  offset: number;
  total?: number;
}

export interface ProductSearchResult {
  products: Product[];
  total: number;
  pagination: Pagination;
  facets?: SearchFacets;
}

export interface SearchFacets {
  categories: FacetItem[];
  brands: FacetItem[];
  priceRanges: PriceRangeFacet[];
}

export interface FacetItem {
  value: string;
  count: number;
}

export interface PriceRangeFacet {
  min: number;
  max: number;
  count: number;
}

/**
 * Product recommendations
 */
export interface ProductRecommendation {
  productId: string;
  score: number;
  reason: RecommendationReason;
}

export enum RecommendationReason {
  SIMILAR = 'similar',
  FREQUENTLY_BOUGHT_TOGETHER = 'frequently_bought_together',
  CUSTOMERS_ALSO_VIEWED = 'customers_also_viewed',
  BASED_ON_HISTORY = 'based_on_history'
}

/**
 * Product comparison
 */
export interface ProductComparison {
  products: Product[];
  differences: ComparisonDifference[];
  similarities: string[];
}

export interface ComparisonDifference {
  attribute: string;
  values: Record<string, any>;
}