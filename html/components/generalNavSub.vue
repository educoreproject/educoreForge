<script setup>
	import { useLoginStore } from '@/stores/loginStore';
	import { computed } from 'vue';
	import { useRouter } from 'vue-router';
	
	const LoginStore = useLoginStore();
	const router = useRouter();

	if (router?.currentRoute.value.query.logout) {
		LoginStore.logout();
	}

	// Check if we're on the work page
	const isWorkPage = computed(() => {
		return router.currentRoute.value.path === '/work' || 
		       router.currentRoute.value.path === '/work/';
	});

	// Check if we're on the admin page
	const isAdminPage = computed(() => {
		return router.currentRoute.value.path === '/admin' || 
		       router.currentRoute.value.path === '/admin/';
	});

	const reloadPage = () => {
		window.location.href = window.location.href.replace(
			/^(https?:\/\/[^\/]+).*/,
			'$1',
		);
	};
</script>

<template>
	<!-- Top banner (not an app bar) -->
	<div class="banner justify-center align-center">
		<h1 class="banner-title">educoreForge</h1>
	</div>

	<!-- Navigation bar -->
	<v-app-bar app elevation="0" class="border-bottom border-1"
		v-if="true || LoginStore.validUser"
	>
		<v-app-bar-title class="titleOrange">
			<template v-if="isAdminPage">Admin Tools</template>
			<template v-else>educoreForge Tools</template>
		</v-app-bar-title>

		<v-btn
			v-if="(LoginStore.loggedInUser.role === 'client') && !isWorkPage"
			prepend-icon="mdi-image"
			title="Get to Work"
			:to="{ path: 'work' }"
		>
			Open Work.vue
		</v-btn>

		<v-btn
			v-if="!isAdminPage && LoginStore.loggedInUser.role === 'admin'"
			prepend-icon="mdi-shield-account"
			title="Admin Tools"
			:to="{ path: 'admin' }"
		>
			ADMIN
		</v-btn>

		<v-btn
			prepend-icon="mdi-account"
			title="Profile"
			:to="{ path: 'utility', query: { purpose: 'profile' } }"
		>
			<span v-if="LoginStore.loggedInUser.last">
				{{ LoginStore.loggedInUser.first }} {{ LoginStore.loggedInUser.last }}
			</span>
			<span v-else>{{ LoginStore.loggedInUser.username }}</span>
		</v-btn>

		<v-btn prepend-icon="mdi-logout" title="Logout" @click="reloadPage">
			Logout
		</v-btn>
	</v-app-bar>
</template>

<style scoped>
	/* Banner styling */
	.banner {
		background: #ffc425;
		padding: 0.1rem;
		text-align: center;
	}

	.banner-title {
		margin: 0;
		color: #fff;
		font-family: 'Roboto', sans-serif;
		font-size: 1.5rem;
	}
	.titleOrange {
		color: #ffc425;
		font-weight: bold;
		padding-left: 5px;
	}
	.v-app-bar {
		margin-top: 2.5rem;
	}
	/* Toolbar title alignment fixes */
	.v-app-bar-title {
		margin-inline-start: 0 !important;
	}
</style>
