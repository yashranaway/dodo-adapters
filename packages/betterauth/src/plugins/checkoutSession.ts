import type DodoPayments from "dodopayments";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { createAuthEndpoint } from "better-auth/plugins";
import { z } from "zod";
import {
  checkoutSessionPayloadSchema,
  createCheckoutSession,
  type CheckoutSessionResponse,
} from "@dodopayments/core/checkout";

export interface CheckoutSessionOptions {
  /**
   * Checkout Success URL
   */
  successUrl?: string;
  /**
   * Only allow authenticated customers to checkout
   */
  authenticatedUsersOnly?: boolean;
}

export const checkoutSession =
  (options: CheckoutSessionOptions = {}) =>
  (dodopayments: DodoPayments) => {
    return {
      checkoutSession: createAuthEndpoint(
        "/dodopayments/checkout-session",
        {
          method: "POST",
          body: checkoutSessionPayloadSchema.extend({
            referenceId: z.string().optional(),
          }),
          requireRequest: true,
        },
        async (ctx): Promise<CheckoutSessionResponse> => {
          const session = await getSessionFromCtx(ctx);

          if (options.authenticatedUsersOnly && !session?.user.id) {
            throw new APIError("UNAUTHORIZED", {
              message: "You must be logged in to checkout",
            });
          }

          try {
            const payload = {
              ...ctx.body,
              // If successUrl is provided, prefer it over incoming payload return_url
              ...(options.successUrl
                ? {
                    return_url: new URL(
                      options.successUrl,
                      ctx.request?.url,
                    ).toString(),
                  }
                : {}),
              // Auto-fill customer fields from session when missing
              customer: {
                email: session?.user.email,
                name: session?.user.name,
                ...(ctx.body?.customer || {}),
              },
              // Attach referenceId into metadata for downstream correlation
              metadata: ctx.body?.referenceId
                ? {
                    referenceId: ctx.body.referenceId,
                    ...(ctx.body?.metadata || {}),
                  }
                : ctx.body?.metadata,
            } as z.infer<typeof checkoutSessionPayloadSchema> & {
              referenceId?: string;
            };

            const result = await createCheckoutSession(payload, {
              bearerToken: dodopayments.bearerToken,
              environment: dodopayments.baseURL.includes("test")
                ? "test_mode"
                : "live_mode",
            });

            return ctx.json({
              session_id: result.session_id,
              checkout_url: result.checkout_url,
            });
          } catch (e: unknown) {
            if (e instanceof Error) {
              ctx.context.logger.error(
                `DodoPayments checkout session creation failed. Error: ${e.message}`,
              );
            }

            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Checkout session creation failed",
            });
          }
        },
      ),
    };
  };


