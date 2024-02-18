import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { authGuard } from '@/server/trpc/middlewares/auth-guard'
import { procedure } from '@/server/trpc/procedures'
import { IdSchema } from '@/utils/server/base-schemas'
import { router } from '@/server/trpc/router'

const SendFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canSendFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = SendFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('users')
      .where('users.id', '=', friendUserId)
      .select('id')
      .limit(1)
      .executeTakeFirstOrThrow(
        () =>
          new TRPCError({
            code: 'BAD_REQUEST',
          })
      )

    return next({ ctx })
  }
)

const AnswerFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canAnswerFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = AnswerFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('friendships')
      .where('friendships.userId', '=', friendUserId)
      .where('friendships.friendUserId', '=', ctx.session.userId)
      .where(
        'friendships.status',
        '=',
        FriendshipStatusSchema.Values['requested']
      )
      .select('friendships.id')
      .limit(1)
      .executeTakeFirstOrThrow(() => {
        throw new TRPCError({
          code: 'BAD_REQUEST',
        })
      })

    return next({ ctx })
  }
)

export const friendshipRequestRouter = router({
  send: procedure
    .use(canSendFriendshipRequest)
    .input(SendFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const check = await ctx.db
        .selectFrom('friendships')
        .select('id')
        .where('friendships.userId', '=', ctx.session.userId)
        .where('friendships.friendUserId', '=', input.friendUserId)
        .where(
          'friendships.status',
          '=',
          FriendshipStatusSchema.Values['declined']
        )
        .executeTakeFirst()

      if (check) {
        return ctx.db
          .updateTable('friendships')
          .set({ status: FriendshipStatusSchema.Values['requested'] })
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', input.friendUserId)
          .execute()
      } else {
        return ctx.db
          .insertInto('friendships')
          .values({
            userId: ctx.session.userId,
            friendUserId: input.friendUserId,
            status: FriendshipStatusSchema.Values['requested'],
          })
          .execute()
      }
    }),

  accept: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction().execute(async (t) => {
        const { friendUserId } = AnswerFriendshipRequestInputSchema.parse(input)

        await t
          .updateTable('friendships')
          .set({ status: FriendshipStatusSchema.Values['accepted'] })
          .where('friendships.userId', '=', friendUserId)
          .where('friendships.friendUserId', '=', ctx.session.userId)
          .execute();

        const check = await t
          .selectFrom('friendships')
          .selectAll()
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', friendUserId)
          .where(
            'friendships.status',
            '=',
            FriendshipStatusSchema.Values['requested']
          )
          .executeTakeFirst();

        if (check) {
          await t
            .updateTable('friendships')
            .set({ status: FriendshipStatusSchema.Values['accepted'] })
            .where('friendships.userId', '=', ctx.session.userId)
            .where('friendships.friendUserId', '=', friendUserId)
            .execute();
        } else {
          await t
            .insertInto('friendships')
            .values({
              userId: ctx.session.userId,
              friendUserId,
              status: FriendshipStatusSchema.Values['accepted'],
            })
            .execute();
        }
      })
    }),

  decline: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction().execute(async (t) => {
        const { friendUserId } = AnswerFriendshipRequestInputSchema.parse(input);

        // Set the friendship request status to `declined`
        await t.updateTable('friendships')
          .set({ status: FriendshipStatusSchema.Values['declined'] })
          .where('friendships.userId', '=', friendUserId)
          .where('friendships.friendUserId', '=', ctx.session.userId)
          .execute();
      });
      console.log("decline")
    }),
})
