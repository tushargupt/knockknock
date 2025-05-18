package com.knockknock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationManagerCompat

/**
 * Broadcast Receiver to handle notification cleanup as a fallback mechanism.
 */
class NotificationCleanupReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "CleanupReceiver"
        private const val INCOMING_CALL_ID = 1001
        private const val END_CALL_ID = 1002
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        Log.d(TAG, "Received notification cleanup broadcast (via AlarmManager fallback)")

        if (context == null) {
            Log.e(TAG, "Context is null, cannot cleanup notifications.")
            return
        }

        // --- Simplified Logic ---
        // Sole responsibility: Cancel the notifications.
        try {
            val notificationManager = NotificationManagerCompat.from(context)
            Log.d(TAG, "Attempting to cancel notifications: INCOMING_CALL_ID=$INCOMING_CALL_ID, END_CALL_ID=$END_CALL_ID")
            notificationManager.cancel(INCOMING_CALL_ID)
            notificationManager.cancel(END_CALL_ID)
            Log.i(TAG, "Notifications canceled via broadcast receiver (fallback).")


        } catch (e: Exception) {
            Log.e(TAG, "Error canceling notifications in receiver", e)
        }
        // --- End Simplified Logic ---
    }
}