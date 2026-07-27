CREATE TYPE "SpecificationDeliveryMode" AS ENUM ('ANSWER_ONLY', 'REPOSITORY_CHANGE');

ALTER TABLE "specifications"
ADD COLUMN "delivery_mode" "SpecificationDeliveryMode" NOT NULL DEFAULT 'REPOSITORY_CHANGE';
