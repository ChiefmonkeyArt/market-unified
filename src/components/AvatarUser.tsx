import * as React from 'react'
import { useState } from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { cn, getHexColorFingerprintFromHexPubkey, isValidHexKey } from '@/lib/utils'
import { getNormalizedProfileDisplayName, getNormalizedProfilePicture, useProfile } from '@/queries/profiles'
import { Spinner } from '@ui/primitives/spinner'

interface AvatarUserProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
	pubkey?: string
	/** Tint the fallback with the pubkey's colour fingerprint (auction participant lists). */
	colored?: boolean
	/** With no profile name, show the pubkey's first two hex chars instead of a generic initial. */
	deterministicFallbackText?: boolean
}

type ImageLoadingStatus = NonNullable<
	Parameters<NonNullable<React.ComponentProps<typeof AvatarPrimitive.Image>['onLoadingStatusChange']>>[0]
>

function AvatarUser({ pubkey, className, colored = false, deterministicFallbackText = false, ...props }: AvatarUserProps) {
	const { data: profileData, isLoading } = useProfile(pubkey)
	const { profile } = profileData ?? {}

	const profileName = getNormalizedProfileDisplayName(profile)
	const profilePicture = getNormalizedProfilePicture(profile)
	const [imageState, setImageState] = useState<{ src: string; status: ImageLoadingStatus }>({ src: '', status: 'idle' })
	const imageStatus = profilePicture ? (imageState.src === profilePicture ? imageState.status : 'loading') : 'idle'
	const isImageLoading = imageStatus === 'loading'

	// Use a simple initial for the fallback when no profile name is available.
	const getFallbackText = () => {
		if (profileName) return profileName.charAt(0).toUpperCase()
		if (deterministicFallbackText && pubkey && isValidHexKey(pubkey)) return pubkey.slice(0, 2).toUpperCase()
		return 'N'
	}
	const fallbackBackgroundColor = colored && pubkey && isValidHexKey(pubkey) ? getHexColorFingerprintFromHexPubkey(pubkey) : undefined

	const showSpinner = isLoading || isImageLoading

	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full w-6 h-6', className)}
			{...props}
		>
			{profilePicture && (
				<AvatarPrimitive.Image
					data-slot="avatar-image"
					className="aspect-square size-full"
					src={profilePicture}
					alt={profileName || 'User avatar'}
					onLoadingStatusChange={(status) => setImageState({ src: profilePicture, status })}
				/>
			)}
			<AvatarPrimitive.Fallback
				data-slot="avatar-fallback"
				className="bg-neo-purple text-white flex size-full items-center justify-center rounded-full text-center"
				style={fallbackBackgroundColor ? { backgroundColor: fallbackBackgroundColor } : undefined}
			>
				{showSpinner ? <Spinner className="h-1/2 w-1/2 text-white" /> : getFallbackText()}
			</AvatarPrimitive.Fallback>
		</AvatarPrimitive.Root>
	)
}

export { AvatarUser }
