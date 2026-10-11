<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Multi-salon data is isolated by `salon_id` with RLS helpers `is_salon_owner`/`is_salon_member`; public booking goes only through security-definer RPCs (`get_public_salon`, `get_busy_times`, `create_public_booking`) so anonymous visitors never read tables directly.
- Double bookings are prevented by a gist exclusion constraint on bookings (staff + time range); UI just surfaces the error.
- AI calls live in `src/lib/ai.functions.ts` as authenticated server functions streaming from the gateway Responses API.
