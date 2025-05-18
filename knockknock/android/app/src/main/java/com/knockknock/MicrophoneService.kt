package com.knockknock // Adjust if your package name is different

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

class MicrophoneService : Service() {

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "MicrophoneServiceChannel"
        const val NOTIFICATION_ID = 1 // Must be > 0
        const val ACTION_START = "com.knockknock.mic.ACTION_START"
        const val ACTION_STOP = "com.knockknock.mic.ACTION_STOP"
        private const val TAG = "MicrophoneService"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Microphone Service onCreate")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action

        Log.d(TAG, "onStartCommand received action: $action")

        when (action) {
            ACTION_START -> {
                startForeground(NOTIFICATION_ID, createNotification())
                Log.i(TAG, "Foreground service started")
                // IMPORTANT: We are NOT starting AudioRecord here.
                // react-native-webrtc handles the actual mic stream.
            }
            ACTION_STOP -> {
                stopSelf() // This will trigger onDestroy
                Log.i(TAG, "Foreground service stopping")
            }
            else -> {
                Log.w(TAG, "Unknown action received or null intent")
                stopSelf() // Stop if started with wrong intent
            }
        }

        // START_NOT_STICKY: If the service is killed, it will not be restarted automatically.
        // This is suitable because the service should only run when explicitly started by the app during a call.
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Microphone Service Channel", // User visible name
                NotificationManager.IMPORTANCE_LOW // Low importance for background tasks
            )
            serviceChannel.description = "Notification channel for active call microphone service"

            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(serviceChannel)
            Log.d(TAG, "Notification channel created")
        }
    }

   private fun createNotification(): Notification {
        Log.d(TAG, "Creating notification")
        // Intent to open the app when notification is tapped
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, pendingIntentFlags)


       // Use your app's icon
       val icon = R.mipmap.ic_launcher // Make sure this resource exists

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Microphone is active")
            .setContentText("Microphone is active for the call.")
            .setSmallIcon(icon) // Use a valid icon resource
            .setContentIntent(pendingIntent)
             // Make the notification less intrusive
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // Prevent user from dismissing it
            .setOngoing(true)
            // Show time only if needed, often omitted for low priority ongoing
            // .setUsesChronometer(true)
            // .setWhen(System.currentTimeMillis()) // Set initial time if not using chronometer
            .build()
    }


    override fun onBind(intent: Intent): IBinder? {
        // We don't provide binding, so return null
        return null
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "Microphone Service onDestroy")
        // Clean up resources if any were used (though we aren't using AudioRecord here)
        // Make sure foreground service is stopped
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
             stopForeground(STOP_FOREGROUND_REMOVE) // Use STOP_FOREGROUND_REMOVE for API 24+
        } else {
             @Suppress("DEPRECATION") // Suppress deprecation warning for older APIs
             stopForeground(true)
        }
        Log.d(TAG, "Foreground service stopped via onDestroy")
    }
}