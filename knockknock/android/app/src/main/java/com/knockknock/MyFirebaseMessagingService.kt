package com.knockknock

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MyFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        private const val TAG = "FCMService"
        // Call Notification Constants
        private const val INCOMING_CALL_CHANNEL_ID = "incoming_calls"
        private const val END_CALL_CHANNEL_ID = "end_calls"
        private const val INCOMING_CALL_ID = 1001
        private const val END_CALL_ID = 1002

        // *** Knock Notification Constants (NEW) ***
        private const val KNOCK_CHANNEL_ID = "knocks" // New channel ID
        // private const val KNOCK_NOTIFICATION_ID = 1003 // New base notification ID for knocks
        // We'll use a TAG to make knocks unique per sender: knock_[senderDeviceId]

        // Cleanup Constants
        private const val CLEANUP_ALARM_REQUEST_CODE = 9001
        private const val CLEANUP_DELAY_MS = 20000L
    }

    override fun onCreate() {
        super.onCreate()
        try {
            // Create all necessary channels on service creation
            createIncomingCallNotificationChannel()
            createEndCallNotificationChannel()
            createKnockNotificationChannel() // Create the new channel
        } catch (e: Exception) {
            Log.e(TAG, "Error creating notification channel(s)", e)
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        try {
            Log.d(TAG, "Message received type: ${remoteMessage.data["type"]}")
            Log.d(TAG, "Message data: ${remoteMessage.data}")

            val messageType = remoteMessage.data["type"] ?: ""

            // --- Handling KNOCK --- (NEW BLOCK)
            if (messageType == "knock") {
                showKnockNotification(remoteMessage)
                // DO NOT cancel other notifications or schedule cleanup for knocks
                return // Processing done for knock
            }
            // --- End Handling KNOCK ---


            // Send local broadcast for potential foreground handling (Keep this)
            // This allows the running app to potentially react to any notification type
            val intent = Intent("CALL_NOTIFICATION").apply { // Maybe rename action later if needed
                remoteMessage.data.forEach { (key, value) ->
                    putExtra(key, value)
                }
            }
            LocalBroadcastManager.getInstance(this).sendBroadcast(intent)


            // --- Handling End Call ---
            if (messageType == "end_call") {
                // 1. Immediately cancel relevant *call* notifications
                cancelCallNotifications() // Only cancels INCOMING_CALL_ID and END_CALL_ID

                // 2. Show a temporary "End Call" notification
                showEndCallNotification(remoteMessage)

                // 3. Schedule a fallback cleanup for call notifications via AlarmManager
                scheduleFallbackCleanup() // Only schedules cleanup for INCOMING_CALL_ID and END_CALL_ID

                return // Processing done for end_call
            }

            // --- Handling Incoming Call ---
            if (messageType == "incoming_call") {
                // 1. Cancel any previous stale *call* notifications first
                 cancelCallNotifications() // Only cancels INCOMING_CALL_ID and END_CALL_ID

                // 2. Show the incoming call notification
                showIncomingCallNotification(remoteMessage)

                // 3. Start MainActivity if needed (Keep this logic)
                if (!isAppInForeground()) {
                    startMainActivity(remoteMessage)
                }

                // 4. Optional: WakeLock for incoming call (Keep if needed)
                acquireWakeLock("KnockKnock:IncomingCallWakeLock")

                return // Processing done for incoming_call
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error in onMessageReceived", e)
        }
    }

    // --- Utility Functions (Unchanged) ---
    private fun isAppInForeground(): Boolean {
        val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val appProcesses = activityManager.runningAppProcesses ?: return false
        val packageName = packageName
        return appProcesses.any {
            it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND &&
                    it.processName == packageName
        }
    }

    private fun startMainActivity(remoteMessage: RemoteMessage) {
         try {
            val mainIntent = Intent(applicationContext, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                remoteMessage.data.forEach { (key, value) ->
                    putExtra(key, value)
                }
            }
            startActivity(mainIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting main activity", e)
        }
    }
    // --- End Utility Functions ---


    // --- Notification Handling ---

    // This function ONLY cancels call-related notifications
    private fun cancelCallNotifications() {
        try {
            val notificationManager = NotificationManagerCompat.from(this)
            Log.d(TAG, "Canceling CALL notifications: INCOMING_CALL_ID=$INCOMING_CALL_ID, END_CALL_ID=$END_CALL_ID")
            notificationManager.cancel(INCOMING_CALL_ID) // Call ID
            notificationManager.cancel(END_CALL_ID)     // End Call ID
            // It does NOT cancel KNOCK_NOTIFICATION_ID
        } catch (e: Exception) {
            Log.e(TAG, "Error canceling call notifications", e)
        }
    }

    // Create channels
     private fun createIncomingCallNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                INCOMING_CALL_CHANNEL_ID,
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications for incoming calls"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 250, 250)
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                enableLights(true)
                setBypassDnd(true)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
            Log.d(TAG, "Created/Updated incoming call notification channel")
        }
    }

    private fun createEndCallNotificationChannel() {
         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                END_CALL_CHANNEL_ID,
                "Call Information",
                NotificationManager.IMPORTANCE_DEFAULT // Lower importance
            ).apply {
                description = "Notifications for ended calls"
                enableVibration(false)
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                enableLights(false)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
            Log.d(TAG, "Created/Updated end call notification channel")
        }
    }

    // Create channel for knocks (NEW)
    private fun createKnockNotificationChannel() {
         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                KNOCK_CHANNEL_ID, // Use specific ID
                "Knocks",         // Channel name visible to user
                NotificationManager.IMPORTANCE_DEFAULT // Default importance is usually fine
            ).apply {
                description = "Notifications when someone knocks you"
                enableVibration(true) // Maybe a short vibration?
                vibrationPattern = longArrayOf(0, 150) // Example: short buzz
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC // Show on lock screen
                enableLights(true)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
            Log.d(TAG, "Created/Updated knock notification channel")
        }
    }


    // Display functions
    private fun showIncomingCallNotification(remoteMessage: RemoteMessage) {
        // (Keep existing implementation - uses INCOMING_CALL_CHANNEL_ID and INCOMING_CALL_ID)
         try {
            val callerName = remoteMessage.data["callerName"] ?: "Unknown User"
            Log.d(TAG, "Showing incoming call notification from: $callerName")
            val contentIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra("type", "incoming_call")
                remoteMessage.data.forEach { (key, value) -> putExtra(key, value) }
            }
            val pendingContentIntent = PendingIntent.getActivity(this, 1, contentIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val pendingFullScreenIntent = PendingIntent.getActivity(this, 0, contentIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = NotificationCompat.Builder(this, INCOMING_CALL_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Incoming call from $callerName")
                .setContentText("Tap to answer")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setFullScreenIntent(pendingFullScreenIntent, true)
                .setContentIntent(pendingContentIntent)
                .setTimeoutAfter(60000)
            val notificationManager = NotificationManagerCompat.from(this)
            // Simplified permission check for brevity (keep your original if needed)
            notificationManager.notify(INCOMING_CALL_ID, builder.build())
            Log.d(TAG, "Incoming call notification shown")
        } catch (e: Exception) {
            Log.e(TAG, "Error showing incoming call notification", e)
        }
    }

    private fun showEndCallNotification(remoteMessage: RemoteMessage) {
         // (Keep existing implementation - uses END_CALL_CHANNEL_ID and END_CALL_ID)
         try {
            val callerName = remoteMessage.data["callerName"] ?: "Unknown User"
            Log.d(TAG, "Showing end call notification from: $callerName")
            val builder = NotificationCompat.Builder(this, END_CALL_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Call ended with $callerName")
                .setContentText("The call has ended.")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setTimeoutAfter(15000)
                .setOngoing(false)
             val contentIntent = Intent(this, MainActivity::class.java).apply {
                 addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
             }
             val pendingContentIntent = PendingIntent.getActivity(this, 2, contentIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
             builder.setContentIntent(pendingContentIntent)
            val notificationManager = NotificationManagerCompat.from(this)
            // Simplified permission check for brevity (keep your original if needed)
            notificationManager.notify(END_CALL_ID, builder.build())
            Log.d(TAG, "End call notification shown")
        } catch (e: Exception) {
            Log.e(TAG, "Error showing end call notification", e)
        }
    }

    // Show Knock Notification (NEW FUNCTION)
   private fun showKnockNotification(remoteMessage: RemoteMessage) {
        try {
            val senderName = remoteMessage.data["senderName"] ?: "Someone"
            // val senderDeviceId = remoteMessage.data["senderDeviceId"] ?: "unknown" // Keep if needed for intent extras
            // val notificationTag = "knock_$senderDeviceId" // REMOVED - Not using tag for display anymore

            // *** Generate a unique ID for each knock notification ***
            // Using timestamp is usually unique enough for notifications.
            val uniqueNotificationId = System.currentTimeMillis().toInt()

            Log.d(TAG, "Showing knock notification from: $senderName (Unique ID: $uniqueNotificationId)")

            // Intent to open app when knock notification is tapped (optional)
            val contentIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("type", "knock") // Identify the action
                putExtra("senderName", senderName)
                // putExtra("senderDeviceId", senderDeviceId) // Add if needed by MainActivity
            }
            // Ensure request code is also unique if intent extras change, or use FLAG_UPDATE_CURRENT carefully
            val pendingIntentRequestCode = uniqueNotificationId // Use unique ID for request code too
            val pendingContentIntent = PendingIntent.getActivity(
                this,
                pendingIntentRequestCode, // Use unique request code
                contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val builder = NotificationCompat.Builder(this, KNOCK_CHANNEL_ID) // Use knock channel
                .setSmallIcon(R.mipmap.ic_launcher) // Replace with a knock icon if available
                .setContentTitle(senderName)
                .setContentText("Knocked! 👋") // Or get text from payload if needed
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true) // Dismiss when tapped
                .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
                .setOngoing(false)
                .setContentIntent(pendingContentIntent)
                // .setTimeoutAfter(15000) // Auto-dismiss after 15 seconds

            val notificationManager = NotificationManagerCompat.from(this)

            // *** Use the unique ID in the notify call, without a tag ***
            // This ensures each notification is treated as separate by Android.
            // Permission check
             if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    notificationManager.notify(uniqueNotificationId, builder.build()) // Use unique ID, no tag
                    Log.d(TAG, "Knock notification shown (API 33+)")
                } else {
                    Log.w(TAG, "POST_NOTIFICATIONS permission denied, cannot show knock notification.")
                }
            } else {
                notificationManager.notify(uniqueNotificationId, builder.build()) // Use unique ID, no tag
                 Log.d(TAG, "Knock notification shown (pre-API 33)")
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error showing knock notification", e)
        }
    }


    // Cleanup scheduling (Unchanged - only schedules cleanup for CALL notifications)
    private fun scheduleFallbackCleanup() {
        try {
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(this, NotificationCleanupReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(this, CLEANUP_ALARM_REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val triggerAtMillis = SystemClock.elapsedRealtime() + CLEANUP_DELAY_MS
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtMillis, pendingIntent)
            } else {
                alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtMillis, pendingIntent)
            }
            Log.d(TAG, "Scheduled fallback CALL notification cleanup via AlarmManager in ${CLEANUP_DELAY_MS}ms.")
        } catch (e: Exception) {
            Log.e(TAG, "Error scheduling fallback cleanup alarm", e)
        }
    }

    // WakeLock (Unchanged - likely only needed for incoming calls)
    private fun acquireWakeLock(lockTag: String, timeout: Long = 60000L) {
         var wakeLock: PowerManager.WakeLock? = null
         try {
             Log.d(TAG, "Acquiring WakeLock: $lockTag")
             val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
             wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, lockTag)
             wakeLock?.acquire(timeout)
         } catch (e: Exception) {
             Log.e(TAG, "Error acquiring WakeLock: $lockTag", e)
         }
    }


    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "FCM token refreshed: $token")
        // TODO: Handle token refresh: send it to your server
    }
}