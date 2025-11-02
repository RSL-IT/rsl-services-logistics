-- CreateEnum
CREATE TYPE "DiscountCombinesWithType" AS ENUM ('product', 'order', 'shipping', 'product_order', 'product_shipping', 'order_shipping', 'shipping_order_product');

-- AlterTable
ALTER TABLE "tbl_powerbuy_config" ADD COLUMN     "discount_combines_with" "DiscountCombinesWithType";
